import path from 'node:path'

import { createClient, type Client, type Config } from '@libsql/client'
import { sqliteAdapter } from '@payloadcms/db-sqlite'

export const DEFAULT_BUSY_TIMEOUT_MS = 5000

/** Per-connection pragmas. `journal_mode=WAL` is stored in the file, so it is set once on connect. */
export function connectionPragmas(busyTimeoutMs: number, readOnly = false): string {
  return [
    `PRAGMA busy_timeout = ${Math.max(0, Math.floor(busyTimeoutMs))};`,
    'PRAGMA foreign_keys = ON;',
    'PRAGMA synchronous = NORMAL;',
    // libsql rejects `?mode=ro` URLs, so read-only is enforced per connection instead.
    ...(readOnly ? ['PRAGMA query_only = ON;'] : []),
  ].join('\n')
}

/** `file:` URL for libsql from a filesystem path (resolved against the working directory). */
export function databaseUrl(databasePath: string): string {
  return `file:${path.resolve(databasePath)}`
}

/**
 * Creates a libsql client that re-applies the pragmas on every connection it opens.
 *
 * libsql's local client opens a brand-new connection after each `transaction()`, and a new
 * connection starts with SQLite's defaults (busy_timeout 0, foreign_keys off). A single PRAGMA at
 * startup would only cover the first connection, so the next write under load would fail with
 * SQLITE_BUSY. The pragmas run in the same synchronous turn as the call that opens the
 * connection, so nothing can slip in between.
 */
export function createGuardedClient(
  config: Config,
  options: { busyTimeoutMs?: number; readOnly?: boolean } = {},
): Client {
  const pragmas = connectionPragmas(
    options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS,
    options.readOnly ?? false,
  )
  const client = createClient(config)
  const execute = client.execute.bind(client)
  const batch = client.batch.bind(client)
  const transaction = client.transaction.bind(client)
  const executeMultiple = client.executeMultiple.bind(client)

  // The client has already opened its first connection by now, without our pragmas.
  let fresh = true

  const setUp = (): Promise<void> | undefined => {
    if (!fresh) return undefined
    fresh = false
    return executeMultiple(pragmas)
  }
  // Starts both calls before the first await so they run on the same connection.
  const guarded = async <T>(call: () => Promise<T>): Promise<T> => {
    const setup = setUp()
    const result = call()
    await setup
    return result
  }

  client.execute = ((...args: Parameters<Client['execute']>) =>
    guarded(() => execute(...args))) as Client['execute']
  client.batch = ((...args: Parameters<Client['batch']>) =>
    guarded(() => batch(...args))) as Client['batch']
  client.executeMultiple = ((...args: Parameters<Client['executeMultiple']>) =>
    guarded(() => executeMultiple(...args))) as Client['executeMultiple']
  client.transaction = ((...args: Parameters<Client['transaction']>) =>
    guarded(() => {
      const tx = transaction(...args)
      // The client drops its connection as soon as a transaction starts on it (synchronously),
      // so the next call opens a new one.
      fresh = true
      return tx
    })) as Client['transaction']

  return client
}

type SqliteAdapterArgs = Parameters<typeof sqliteAdapter>[0]

export type DatabaseOptions = {
  databasePath: string
  /** The process that owns schema changes and WAL setup. Others only read. */
  writer: boolean
  /** Push the schema to the DB on startup. Local dev only; everywhere else, use migrations. */
  push: boolean
  migrationDir: string
  busyTimeoutMs?: number
}

/**
 * The SQLite adapter, with WAL, busy_timeout and foreign_keys on every connection. Payload's own
 * connect() skips its client setup if a client already exists, so the guarded client is created
 * here and WAL is switched on once.
 */
export function buildDatabase(options: DatabaseOptions) {
  const { databasePath, writer, push, migrationDir } = options
  const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS
  const args: SqliteAdapterArgs = {
    client: { url: databaseUrl(databasePath) },
    busyTimeout: busyTimeoutMs,
    push,
    migrationDir,
    // Only used by the adapter's own setup, which the guarded client replaces.
    wal: writer ? { synchronous: 'NORMAL' } : false,
  }
  const adapter = sqliteAdapter(args)

  return {
    ...adapter,
    init: (initArgs: Parameters<typeof adapter.init>[0]) => {
      const db = adapter.init(initArgs)
      const originalConnect = db.connect
      if (!originalConnect) throw new Error('The SQLite adapter has no connect()')
      const connect = originalConnect.bind(db)
      db.connect = async (connectOptions) => {
        if (!db.client) {
          db.client = createGuardedClient(args.client, { busyTimeoutMs, readOnly: !writer })
          if (writer) {
            await db.client.execute('PRAGMA journal_mode = WAL;')
          }
        }
        await connect(connectOptions)
      }
      return db
    },
  }
}
