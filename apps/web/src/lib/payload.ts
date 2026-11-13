import { buildSiteConfig, siteConfigOptionsFromEnv } from '@house/cms-config'
import { getPayload, type Payload } from 'payload'

/**
 * The one way `web` reaches content: Payload's Local API over the shared SQLite file.
 *
 * The `web` role never migrates or pushes, and its connection runs `PRAGMA query_only = ON`
 * (see `packages/cms-config/src/db.ts`), so any write fails. The config is built lazily, on the
 * first request, so `next build` needs no DATABASE_PATH and never opens the database.
 *
 * Do not call this from a page that Next might prerender at build time; mark such pages
 * `export const dynamic = 'force-dynamic'`, or read through a cached helper in `src/data/`.
 */
let cached: Promise<Payload> | undefined

export function getWebPayload(): Promise<Payload> {
  cached ??= buildSiteConfig(siteConfigOptionsFromEnv('web'))
    .then((config) => getPayload({ config }))
    .catch((error: unknown) => {
      cached = undefined // let the next request retry instead of caching the failure
      throw error
    })
  return cached
}
