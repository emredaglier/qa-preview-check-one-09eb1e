// The release gate (ADR-0005, ADR-0012, CODING_STANDARDS.md "Smoke specs"). It runs against the built
// `web` image on desktop Chromium only, and stays small: the route sweep (every public page loads
// with its content and no console error or 404), not-found pages, assets from the CDN prefix, and
// the request-level checks that need the built image (server HTML, no admin or API routes, the
// revalidate secret, no cookies, one live CMS edit reaching the cached page). The other gate specs
// sit beside this one: a11y.spec.ts, secrets.spec.ts, webgl-fallback.spec.ts and
// checks.selftest.spec.ts. Do not add specs for look, motion or interaction: the owner checks
// those by hand.
import { type APIResponse } from '@playwright/test'

import { PLACEHOLDER_SITE } from '../packages/cms-config/src/seed/placeholder.ts'
import { LIVE_EDIT, UNKNOWN_PATH } from './fixture-data.ts'
import { expect, revalidateSecret, test } from './fixtures.ts'
import { publicRoutes } from './routes.ts'
import { sweepProblems } from './sweep.ts'

/**
 * Every public route of the site, found from its pages (smoke/routes.ts), `/examples/glow` (noindex
 * by design, but public) included. A project gives each dynamic page a sample URL there. The checks
 * that need a route to be indexable only look at response headers, which a meta robots tag does not
 * change, so no route needs an exemption.
 */
const PUBLIC_ROUTES = publicRoutes()

/** Text as React writes it into server HTML. */
const asHtml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')

/**
 * What only the seeded database holds (read from the seed, not restated): an empty page would also
 * carry the layout's default title, so the checks look for the intro too. The tagline is not here:
 * smoke/run.ts replaces it with LIVE_EDIT.tagline before the specs run (see "live edits").
 */
const SEEDED = {
  name: asHtml(PLACEHOLDER_SITE.name),
  intro: asHtml(PLACEHOLDER_SITE.intro),
  description: asHtml(PLACEHOLDER_SITE.defaultDescription),
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const setCookies = (response: APIResponse) =>
  response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === 'set-cookie')
    .map((header) => header.value)

test.describe('public routes', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} loads with its content and no error`, async ({ page, visit }) => {
      expect(await sweepProblems(page, visit, route)).toEqual([])
    })
  }

  test('home shows the seeded text, and the head script has run', async ({ page, visit }) => {
    const failures = await visit('/')
    await expect(page.locator('main#main h1')).toHaveText(PLACEHOLDER_SITE.name)
    await expect(page.getByText(LIVE_EDIT.tagline)).toBeVisible()
    await expect(page.getByText(PLACEHOLDER_SITE.intro)).toBeVisible()
    await expect(page.locator('html[data-js]')).toHaveCount(1)
    expect(failures).toEqual([])
  })

  // The gate builds the image with the production build args (ASSET_PREFIX and DEPLOYMENT_ID), so
  // the served HTML shows whether scripts and styles point at the CDN with the deployment id.
  test('scripts and styles come from the asset prefix, with the deployment id', async ({
    request,
  }) => {
    const prefix = process.env.SMOKE_ASSET_PREFIX
    test.skip(!prefix, 'prefixed builds only')
    const html = await (await request.get('/')).text()
    const urls = [...html.matchAll(/(?:src|href)="([^"]*_next\/static[^"]*)"/g)].map((m) => m[1]!)
    expect(urls.length).toBeGreaterThan(0)
    for (const url of urls) {
      expect(url.startsWith(`${prefix}/_next/static/`), url).toBe(true)
      expect(url, url).toContain('?dpl=')
    }
  })
})

test.describe('not-found', () => {
  test('an unknown path shows the 404 page, with its status', async ({ page, visit }) => {
    const failures = await visit(UNKNOWN_PATH, 404)
    await expect(page.locator('main#main h1')).toHaveText('Page not found')
    expect(failures).toEqual([])
  })
})

test.describe('server HTML', () => {
  test('home has its content, title and description without JavaScript (ADR-0008)', async ({
    request,
  }) => {
    const response = await request.get('/')
    expect(response.status()).toBe(200)
    const html = await response.text()
    expect(html).toMatch(new RegExp(`<h1[^>]*>${escapeRegExp(SEEDED.name)}</h1>`))
    expect(html).toContain(asHtml(LIVE_EDIT.tagline))
    expect(html).toContain(SEEDED.intro)
    expect(html).toContain(`<title>${SEEDED.name}</title>`)
    expect(html).toContain(`<meta name="description" content="${SEEDED.description}"`)
    expect(html).toMatch(/<html[^>]*\slang="en"/)
    expect(html).toContain('<main')
  })
})

test.describe('routes and headers', () => {
  test('web has no /admin and no /api routes (ADR-0002)', async ({ request }) => {
    for (const route of ['/admin', '/admin/login', '/api', '/api/users', '/api/site']) {
      expect((await request.get(route, { maxRedirects: 0 })).status(), route).toBe(404)
    }
  })

  test('the revalidate endpoint needs the shared secret', async ({ request }) => {
    const post = (headers: Record<string, string>) =>
      request.post('/internal/revalidate', { headers, data: { tags: ['global:site'] } })
    expect((await post({})).status()).toBe(401)
    expect((await post({ 'x-revalidate-secret': 'nope' })).status()).toBe(401)
    expect((await post({ 'x-revalidate-secret': revalidateSecret })).status()).toBe(200)
  })

  test('no route sets a cookie', async ({ request }) => {
    for (const route of [...PUBLIC_ROUTES, UNKNOWN_PATH]) {
      expect(setCookies(await request.get(route)), route).toEqual([])
    }
  })

  test('no x-robots-tag on the public instance', async ({ request }) => {
    for (const route of PUBLIC_ROUTES) {
      expect((await request.get(route)).headers()['x-robots-tag'], route).toBeUndefined()
    }
  })
})

// smoke/run.ts saved this through the Local API after warming the cache, so only the revalidate
// hook (cms -> web, over HTTP with the shared secret) can make it show.
test.describe('live edits', () => {
  test('a tagline saved in the CMS shows on the next request', async ({ request }) => {
    const html = await (await request.get('/')).text()
    expect(html).toContain(asHtml(LIVE_EDIT.tagline))
    expect(html).not.toContain(asHtml(PLACEHOLDER_SITE.tagline))
  })
})
