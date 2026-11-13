// A fake public site for the smoke-check and deploy tests: home, sitemap, one content page, one
// static chunk and one media image, each overridable per test. Also records webhook
// POSTs to /hook, so one server can stand in for the site, the CDN and the alert channel.
import http from 'node:http'
import type { AddressInfo } from 'node:net'

export type Route = { status: number; type?: string; body?: string }
export type Hook = { contentType: string; body: string }

const html = (body: string): Route => ({ status: 200, type: 'text/html; charset=utf-8', body })

export const startSiteStub = async () => {
  const hooks: Hook[] = []
  const hits: string[] = []
  // The fake docker (deploy.test.ts) reports which release is "live" via PUT /__live/<tag>; a
  // release in `broken` serves a 500 home, like a bad build behind a healthy container.
  const live = { tag: '', broken: new Set<string>() }
  let base = ''
  const routes = new Map<string, Route>()

  const reset = () => {
    routes.clear()
    routes.set(
      '/',
      html(
        `<!doctype html><html><head><link rel="stylesheet" href="/_next/static/css/a.css">` +
          `<script src="/_next/static/chunks/webpack-abc.js" async=""></script></head>` +
          `<body><main id="main">home</main></body></html>`,
      ),
    )
    routes.set('/_next/static/chunks/webpack-abc.js', {
      status: 200,
      type: 'application/javascript; charset=UTF-8',
      body: 'self.x=1',
    })
    routes.set('/sitemap.xml', {
      status: 200,
      type: 'application/xml',
      body:
        `<?xml version="1.0"?><urlset><url><loc>https://example.test/</loc></url>` +
        `<url><loc>https://example.test/about</loc></url></urlset>`,
    })
    routes.set(
      '/about',
      html(
        `<main id="main"><img src="${base}/media/team-1a2b-small.webp?v=1&amp;x=2" ` +
          `srcSet="${base}/media/team-1a2b-small.webp 640w" alt="Team"></main>`,
      ),
    )
    routes.set('/media/team-1a2b-small.webp', { status: 200, type: 'image/webp', body: 'RIFF' })
  }

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const p = new URL(req.url ?? '/', 'http://stub').pathname
      if (req.method === 'POST' && p === '/hook') {
        hooks.push({
          contentType: req.headers['content-type'] ?? '',
          body: Buffer.concat(chunks).toString(),
        })
        res.writeHead(204).end()
        return
      }
      if (req.method === 'PUT' && p.startsWith('/__live/')) {
        live.tag = p.slice('/__live/'.length)
        res.writeHead(204).end()
        return
      }
      hits.push(p)
      if (p === '/' && live.broken.has(live.tag)) {
        res.writeHead(500, { 'content-type': 'text/plain' }).end('broken release')
        return
      }
      const r = routes.get(p) ?? { status: 404, type: 'text/html', body: 'Not Found' }
      res.writeHead(r.status, { 'content-type': r.type ?? 'text/plain' })
      res.end(r.body ?? '')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  reset()

  return {
    base,
    hooks,
    hits,
    live,
    routes,
    reset,
    /** Only home: no content page and no image besides the chunk. */
    homeOnly() {
      routes.set('/sitemap.xml', {
        status: 200,
        type: 'application/xml',
        body: `<?xml version="1.0"?><urlset><url><loc>https://example.test/</loc></url></urlset>`,
      })
      routes.delete('/about')
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
