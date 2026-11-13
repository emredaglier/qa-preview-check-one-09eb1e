import type { BrowserContext, Route } from '@playwright/test'
import { afterEach, describe, expect, it } from 'vitest'

import { assetTarget, routeAssets } from './network.ts'

const config = {
  baseUrl: 'http://127.0.0.1:32768',
  mediaOrigin: 'http://127.0.0.1:42617',
  assetPrefix: 'https://cdn.atlas.studio/releases/v1.2.3',
}

describe('assetTarget', () => {
  it('lets the container and the media server through', () => {
    expect(assetTarget('http://127.0.0.1:32768/about', config)).toEqual({ kind: 'continue' })
    expect(assetTarget('http://127.0.0.1:42617/media/a.webp', config)).toEqual({
      kind: 'continue',
    })
  })

  it('lets only the container through when there is no media origin', () => {
    const { mediaOrigin: _unused, ...withoutMedia } = config
    expect(assetTarget('http://127.0.0.1:32768/about', withoutMedia)).toEqual({ kind: 'continue' })
    expect(assetTarget('http://127.0.0.1:42617/media/a.webp', withoutMedia)).toEqual({
      kind: 'abort',
    })
  })

  it('answers CDN-prefixed /_next/ files from the container', () => {
    expect(
      assetTarget(
        'https://cdn.atlas.studio/releases/v1.2.3/_next/static/chunks/a.js?dpl=x',
        config,
      ),
    ).toEqual({ kind: 'rewrite', url: 'http://127.0.0.1:32768/_next/static/chunks/a.js' })
  })

  it('aborts CDN requests that are not /_next/ files and every other origin', () => {
    expect(assetTarget('https://cdn.atlas.studio/releases/v1.2.3/logo.svg', config)).toEqual({
      kind: 'abort',
    })
    expect(assetTarget('https://example.com/x.js', config)).toEqual({ kind: 'abort' })
  })

  it('aborts the CDN when the image was built without a prefix', () => {
    expect(
      assetTarget('https://cdn.atlas.studio/_next/a.js', { ...config, assetPrefix: undefined }),
    ).toEqual({ kind: 'abort' })
  })
})

describe('routeAssets', () => {
  const env = { ...process.env }
  afterEach(() => {
    process.env = { ...env }
  })

  // A context that hands back the route handler, and a route for a CDN-prefixed file.
  const setup = async (fulfill: () => Promise<void>) => {
    process.env['SMOKE_BASE_URL'] = config.baseUrl
    process.env['SMOKE_MEDIA_ORIGIN'] = config.mediaOrigin
    process.env['SMOKE_ASSET_PREFIX'] = config.assetPrefix
    let handler: (route: Route) => Promise<void> = async () => {}
    const context = {
      route: async (_pattern: RegExp, fn: typeof handler) => {
        handler = fn
      },
    } as unknown as BrowserContext
    await routeAssets(context)
    const route = {
      request: () => ({ url: () => `${config.assetPrefix}/_next/static/a.js` }),
      fetch: async () => ({ headers: () => ({}) }),
      fulfill,
      abort: async () => {},
      continue: async () => {},
    } as unknown as Route
    return () => handler(route)
  }

  it('does not fail a test when the page closes while a file is being fetched', async () => {
    // What Playwright throws when a tab is closed (a ctrl-click test) mid-request.
    const run = await setup(() =>
      Promise.reject(new Error('route.fulfill: Fetch response has been disposed')),
    )
    await expect(run()).resolves.toBeUndefined()
  })

  it('still reports any other error', async () => {
    const run = await setup(() => Promise.reject(new Error('something else broke')))
    await expect(run()).rejects.toThrow('something else broke')
  })
})
