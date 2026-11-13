// The request policy every browser spec shares. Requests may only go to the container, an optional
// media origin (a stand-in for R2, once a project has uploads) and the (rewritten) asset prefix.
// Anything else is aborted, so a stray external request cannot hide in CI.
//
// CI builds the image with the real CDN prefix (https://cdn.<domain>/releases/<tag>) but uploads
// only after smoke passes (ADR-0005), so the CDN does not have the files yet. Every spec must
// therefore answer those requests from the container. A spec that does not has no JavaScript
// at all in CI: the page never hydrates, and nothing that mounts in an effect ever appears.
import type { BrowserContext } from '@playwright/test'

const origin = (url: string) => new URL(url).origin

/**
 * Where a request for `url` is answered from: itself (container, media server), the container's
 * `/_next/...` file for an asset-prefix URL, or `null` when the request must fail.
 */
export function assetTarget(
  url: string,
  config: { baseUrl: string; mediaOrigin?: string | undefined; assetPrefix?: string | undefined },
): { kind: 'continue' } | { kind: 'rewrite'; url: string } | { kind: 'abort' } {
  const requestOrigin = origin(url)
  if (
    requestOrigin === origin(config.baseUrl) ||
    (config.mediaOrigin && requestOrigin === origin(config.mediaOrigin))
  ) {
    return { kind: 'continue' }
  }
  if (config.assetPrefix && requestOrigin === origin(config.assetPrefix)) {
    const pathname = new URL(url).pathname
    const at = pathname.indexOf('/_next/')
    if (at === -1) return { kind: 'abort' }
    return { kind: 'rewrite', url: `${config.baseUrl}${pathname.slice(at)}` }
  }
  return { kind: 'abort' }
}

/** Applies `assetTarget` to every http(s) request of the context. */
export async function routeAssets(context: BrowserContext): Promise<void> {
  const baseUrl = process.env.SMOKE_BASE_URL
  const mediaOrigin = process.env.SMOKE_MEDIA_ORIGIN || undefined
  if (!baseUrl) throw new Error('Run through `pnpm smoke` (SMOKE_BASE_URL unset).')
  const assetPrefix = process.env.SMOKE_ASSET_PREFIX || undefined
  await context.route(/^https?:/, async (route) => {
    const target = assetTarget(route.request().url(), { baseUrl, mediaOrigin, assetPrefix })
    if (target.kind === 'continue') return route.continue()
    if (target.kind === 'abort') return route.abort('failed')
    try {
      const response = await route.fetch({ url: target.url })
      return await route.fulfill({
        response,
        headers: { ...response.headers(), 'access-control-allow-origin': '*' },
      })
    } catch (error) {
      // A test that closes a tab or ends while a file is still being fetched (a ctrl-click test,
      // a navigation away) makes Playwright throw here. The page is gone, so nobody needs the
      // answer, and the error would be reported as a failure of that test. Anything else is real.
      if (isTeardown(error)) return
      throw error
    }
  })
}

/** What Playwright throws for a request whose page, context or browser has gone away. */
const isTeardown = (error: unknown): boolean =>
  error instanceof Error &&
  /disposed|has been closed|Target (page|context|browser).*closed|Request context disposed/i.test(
    error.message,
  )
