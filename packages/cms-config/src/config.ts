import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig, type PayloadEmailAdapter, type SanitizedConfig } from 'payload'

import { Users } from './collections/Users'
import { buildDatabase, DEFAULT_BUSY_TIMEOUT_MS } from './db'
import { Site } from './globals/Site'
import { revalidateGlobalHook, type RevalidateOptions } from './revalidate'

const here = path.dirname(fileURLToPath(import.meta.url))

/** Committed migrations live next to the source, whichever app loads the config. */
export const MIGRATION_DIR = path.join(here, 'migrations')
/** Generated Payload types are committed here. */
export const TYPES_FILE = path.join(here, 'payload-types.ts')

export type SiteConfigOptions = {
  /**
   * `cms` is the admin app: it owns the database file, WAL setup and the admin UI.
   * `web` is the public site: same collections and globals, no admin UI and no schema changes.
   */
  role: 'cms' | 'web'
  /** Filesystem path of the SQLite file. */
  databasePath: string
  secret: string
  /** Push the schema on startup (local dev only). Defaults to `NODE_ENV === 'development'`. */
  push?: boolean
  busyTimeoutMs?: number
  /** Origins allowed to call the admin API with cookies, e.g. the tailnet HTTPS URL. */
  origins?: string[]
  /** Base directory Payload resolves admin component paths against (the cms app's `src`). */
  adminBaseDir?: string
  /** Where to POST cache tags after a save. Omit (or no URLs) to skip revalidation. */
  revalidate?: RevalidateOptions
}

/** A copy of a `hooks` object with its own array for every hook, so a build never shares one. */
function copyHooks<T extends Record<string, unknown> | undefined>(hooks: T): NonNullable<T> {
  return Object.fromEntries(
    Object.entries(hooks ?? {}).map(([name, list]) => [
      name,
      Array.isArray(list) ? [...list] : list,
    ]),
  ) as NonNullable<T>
}

/** Nothing here sends mail; password reset goes through the admin. Declared to silence the boot warning. */
const emailAdapter: PayloadEmailAdapter = ({ payload }) => ({
  name: 'console',
  defaultFromAddress: 'noreply@example.com',
  defaultFromName: 'House starter',
  sendEmail: async (message) => {
    payload.logger.info({ msg: `Email not sent (no adapter). Subject: "${message.subject}"` })
  },
})

export function buildSiteConfig(options: SiteConfigOptions): Promise<SanitizedConfig> {
  const writer = options.role === 'cms'
  const push = writer && (options.push ?? process.env.NODE_ENV === 'development')

  if (writer) {
    fs.mkdirSync(path.dirname(path.resolve(options.databasePath)), { recursive: true })
  }

  return buildConfig({
    admin: {
      user: Users.slug,
      meta: {
        titleSuffix: '- admin',
        description: 'Admin',
      },
      ...(options.adminBaseDir ? { importMap: { baseDir: options.adminBaseDir } } : {}),
    },
    // Payload mutates the `fields` and `hooks` arrays of the objects it is given (it adds `_order`
    // and its own hooks), so every build gets its own copies (CODING_STANDARDS.md).
    collections: [Users].map((collection) => ({
      ...collection,
      fields: [...collection.fields],
      hooks: copyHooks(collection.hooks),
    })),
    // Every global tells the public site to drop its cached read when it is saved. The hook is
    // appended to the global's own `afterChange` hooks, never replacing them.
    globals: [Site].map((global) => {
      const hooks = copyHooks(global.hooks)
      return {
        ...global,
        fields: [...global.fields],
        hooks: {
          ...hooks,
          afterChange: [...(hooks.afterChange ?? []), revalidateGlobalHook(options.revalidate)],
        },
      }
    }),
    editor: lexicalEditor(),
    db: buildDatabase({
      databasePath: options.databasePath,
      writer,
      push,
      migrationDir: MIGRATION_DIR,
      busyTimeoutMs: options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS,
    }),
    cors: options.origins ?? [],
    csrf: options.origins ?? [],
    email: emailAdapter,
    // The public site reads through the Local API; nothing needs GraphQL.
    graphQL: { disable: true },
    secret: options.secret,
    typescript: { outputFile: TYPES_FILE },
  })
}

/** `"a, b,,c"` -> `['a', 'b', 'c']`: split on commas, trim, drop empty entries. */
const commaList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

/** Reads the shared env vars. Throws a readable error instead of booting half-configured. */
export function siteConfigOptionsFromEnv(
  role: SiteConfigOptions['role'],
  env: Record<string, string | undefined> = process.env,
): SiteConfigOptions {
  const databasePath = env.DATABASE_PATH
  const secret = env.PAYLOAD_SECRET
  if (!databasePath) throw new Error('DATABASE_PATH is not set (see .env.example).')
  if (!secret) throw new Error('PAYLOAD_SECRET is not set (see .env.example).')
  const pushFlag = env.PAYLOAD_DB_PUSH
  const revalidateUrls = commaList(env.REVALIDATE_URLS)
  const revalidateSecret = env.REVALIDATE_SECRET
  if (revalidateUrls.length > 0 && !revalidateSecret) {
    throw new Error('REVALIDATE_URLS is set but REVALIDATE_SECRET is not (see .env.example).')
  }
  const origins = commaList(env.CMS_ORIGINS)
  // Payload's CSRF check is off when the list is empty, so a production cms must name its
  // origins. `next build` (also NODE_ENV=production) never serves a request, so it is exempt.
  const buildPhase = env.NEXT_PHASE === 'phase-production-build'
  if (role === 'cms' && env.NODE_ENV === 'production' && !buildPhase && origins.length === 0) {
    throw new Error(
      'CMS_ORIGINS is not set: production cms needs it for CSRF and CORS (see .env.example).',
    )
  }
  return {
    role,
    databasePath,
    secret,
    ...(pushFlag === undefined ? {} : { push: pushFlag === 'true' }),
    origins,
    ...(revalidateUrls.length > 0 && revalidateSecret
      ? { revalidate: { urls: revalidateUrls, secret: revalidateSecret } }
      : {}),
  }
}
