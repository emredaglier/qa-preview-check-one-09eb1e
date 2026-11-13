import { spawn } from 'node:child_process'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startSiteStub } from './site-stub'

const script = path.resolve(import.meta.dirname, 'smoke.sh')

let site: Awaited<ReturnType<typeof startSiteStub>>

const smoke = (env: Record<string, string> = {}) =>
  new Promise<{ code: number | null; out: string }>((resolve) => {
    const child = spawn('bash', [script, site.base], {
      env: {
        PATH: process.env.PATH ?? '',
        TMPDIR: process.env.TMPDIR ?? '',
        SMOKE_HOME_WAIT: '2',
        ...env,
      },
    })
    let out = ''
    child.stdout.on('data', (d: Buffer) => (out += d))
    child.stderr.on('data', (d: Buffer) => (out += d))
    child.on('close', (code) => resolve({ code, out }))
  })

beforeAll(async () => {
  site = await startSiteStub()
})
afterAll(async () => {
  await site.close()
})
beforeEach(() => {
  site.reset()
  site.hits.length = 0
})

describe('infra/smoke.sh', () => {
  it('passes a healthy site after checking home, a chunk, a content page from the sitemap and an image', async () => {
    const { code, out } = await smoke()
    expect(out).toContain('smoke passed')
    expect(code).toBe(0)
    expect(site.hits).toEqual(
      expect.arrayContaining([
        '/',
        '/_next/static/chunks/webpack-abc.js',
        '/sitemap.xml',
        '/about',
        '/media/team-1a2b-small.webp',
      ]),
    )
  })

  it('skips the page and image checks with a notice when the site has only a home page', async () => {
    site.homeOnly()
    const { code, out } = await smoke()
    expect(code).toBe(0)
    expect(out).toMatch(/NOTICE.*no content page/i)
    expect(out).toMatch(/NOTICE.*no <img>/i)
    expect(site.hits).not.toContain('/media/team-1a2b-small.webp')
  })

  it('skips the page check when there is no sitemap, and checks an image on home', async () => {
    site.routes.delete('/sitemap.xml')
    site.routes.set('/', {
      status: 200,
      type: 'text/html',
      body: `<script src="/_next/static/chunks/webpack-abc.js"></script><img src="/media/team-1a2b-small.webp">`,
    })
    const { code, out } = await smoke()
    expect(code).toBe(0)
    expect(out).toMatch(/NOTICE.*no content page/i)
    expect(site.hits).toContain('/media/team-1a2b-small.webp')
  })

  it('fails when home does not answer 200', async () => {
    site.routes.set('/', { status: 500, body: 'boom' })
    const { code, out } = await smoke()
    expect(code).not.toBe(0)
    expect(out).toMatch(/FAIL.*home/i)
  })

  it('fails when the static chunk is missing (the old in-place-build breakage)', async () => {
    site.routes.delete('/_next/static/chunks/webpack-abc.js')
    const { code, out } = await smoke()
    expect(code).not.toBe(0)
    expect(out).toMatch(/FAIL.*chunk/i)
  })

  it('fails when the chunk URL answers with HTML instead of JavaScript', async () => {
    site.routes.set('/_next/static/chunks/webpack-abc.js', {
      status: 200,
      type: 'text/html',
      body: '<html>',
    })
    const { code } = await smoke()
    expect(code).not.toBe(0)
  })

  it('fails when home links no static chunk at all', async () => {
    site.routes.set('/', { status: 200, type: 'text/html', body: '<html>no scripts</html>' })
    const { code, out } = await smoke()
    expect(code).not.toBe(0)
    expect(out).toMatch(/FAIL.*chunk/i)
  })

  it('fails when the content page is broken', async () => {
    site.routes.set('/about', { status: 500, body: 'boom' })
    const { code, out } = await smoke()
    expect(code).not.toBe(0)
    expect(out).toMatch(/FAIL.*page/i)
  })

  it('fails when the media image is missing or not an image', async () => {
    site.routes.delete('/media/team-1a2b-small.webp')
    expect((await smoke()).code).not.toBe(0)
    site.routes.set('/media/team-1a2b-small.webp', { status: 200, type: 'text/html', body: 'x' })
    const { code, out } = await smoke()
    expect(code).not.toBe(0)
    expect(out).toMatch(/FAIL.*image/i)
  })

  it('fetches an absolute chunk URL on another origin as is (asset prefix on the CDN)', async () => {
    site.routes.set('/', {
      status: 200,
      type: 'text/html',
      body: `<script src="${site.base}/releases/abc/_next/static/chunks/main-1.js"></script>`,
    })
    site.routes.set('/releases/abc/_next/static/chunks/main-1.js', {
      status: 200,
      type: 'text/javascript',
      body: '1',
    })
    const { code } = await smoke()
    expect(code).toBe(0)
    expect(site.hits).toContain('/releases/abc/_next/static/chunks/main-1.js')
  })
})
