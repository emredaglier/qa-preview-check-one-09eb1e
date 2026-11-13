import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createGuardedClient, databaseUrl } from './db'

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'house-db-'))
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

async function pragma(client: ReturnType<typeof createGuardedClient>, name: string) {
  const result = await client.execute(`PRAGMA ${name};`)
  return Object.values(result.rows[0] ?? {})[0]
}

describe('createGuardedClient', () => {
  it('applies busy_timeout and foreign_keys on the first connection', async () => {
    const client = createGuardedClient(
      { url: databaseUrl(path.join(dir, 'a.db')) },
      { busyTimeoutMs: 1234 },
    )
    expect(await pragma(client, 'busy_timeout')).toBe(1234)
    expect(await pragma(client, 'foreign_keys')).toBe(1)
    client.close()
  })

  it('applies them again on the connection opened after a transaction', async () => {
    const client = createGuardedClient(
      { url: databaseUrl(path.join(dir, 'b.db')) },
      { busyTimeoutMs: 777 },
    )
    await client.execute('CREATE TABLE t (id INTEGER PRIMARY KEY)')
    const tx = await client.transaction('write')
    await tx.execute('INSERT INTO t DEFAULT VALUES')
    await tx.commit()
    expect(await pragma(client, 'busy_timeout')).toBe(777)
    expect(await pragma(client, 'foreign_keys')).toBe(1)

    // Straight after a transaction, concurrent callers all land on the configured connection.
    const tx2 = await client.transaction('write')
    await tx2.commit()
    const [a, b] = await Promise.all([
      pragma(client, 'busy_timeout'),
      pragma(client, 'foreign_keys'),
    ])
    expect([a, b]).toEqual([777, 1])
    client.close()
  })
})

describe('createGuardedClient readOnly', () => {
  it('rejects writes on every connection, including after a transaction', async () => {
    const file = path.join(dir, 'ro.db')
    const writer = createGuardedClient({ url: databaseUrl(file) })
    await writer.execute('PRAGMA journal_mode = WAL;')
    await writer.execute('CREATE TABLE t (id INTEGER PRIMARY KEY)')
    await writer.execute('INSERT INTO t DEFAULT VALUES')

    const reader = createGuardedClient({ url: databaseUrl(file) }, { readOnly: true })
    expect((await reader.execute('SELECT count(*) AS n FROM t')).rows[0]?.n).toBe(1)
    await expect(reader.execute('INSERT INTO t DEFAULT VALUES')).rejects.toThrow(/readonly/i)
    await expect(reader.batch(['DELETE FROM t'])).rejects.toThrow(/readonly/i)

    // A read transaction opens a fresh connection; the next call must be read-only again.
    const tx = await reader.transaction('read')
    await tx.commit()
    await expect(reader.execute('INSERT INTO t DEFAULT VALUES')).rejects.toThrow(/readonly/i)
    await expect(reader.execute('DROP TABLE t')).rejects.toThrow(/readonly/i)

    // The writer keeps working and the reader sees its change (WAL, separate connections).
    await writer.execute('INSERT INTO t DEFAULT VALUES')
    expect((await reader.execute('SELECT count(*) AS n FROM t')).rows[0]?.n).toBe(2)
    reader.close()
    writer.close()
  })
})
