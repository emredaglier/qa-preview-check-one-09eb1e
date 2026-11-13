import { getWebPayload } from '../../../lib/payload'

export const dynamic = 'force-dynamic'

/**
 * Container health check (Docker HEALTHCHECK, Compose). Opens the shared SQLite file through the
 * read-only `web` role and reads the Site global. Under `/internal`, so Caddy 404s it publicly.
 */
export async function GET(): Promise<Response> {
  try {
    const payload = await getWebPayload()
    // The same public read the pages make, with access rules on: the Users collection is admin-only.
    await payload.findGlobal({ slug: 'site', overrideAccess: false, depth: 0 })
    return Response.json({ status: 'ok' })
  } catch {
    return Response.json({ status: 'unhealthy' }, { status: 503 })
  }
}
