import http from 'node:http'
import type { AddressInfo } from 'node:net'

export type StubObject = {
  body: Buffer
  headers: http.IncomingHttpHeaders
  lastModified: Date
}

/**
 * In-process S3 stub (PUT, list v2, DELETE) with path-style keys `/<bucket>/<key>`. It records
 * every request so tests can assert that a script never sent a DELETE. No Docker or MinIO needed.
 */
export async function startS3Stub() {
  const objects = new Map<string, StubObject>()
  const requests: { method: string; key: string }[] = []
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://stub')
      const key = decodeURIComponent(url.pathname).replace(/^\/[^/]+\/?/, '')
      requests.push({ method: req.method ?? '', key })
      if (req.method === 'PUT') {
        objects.set(key, {
          body: Buffer.concat(chunks),
          headers: req.headers,
          lastModified: new Date(),
        })
        res.writeHead(200, { ETag: '"stub"' })
        return res.end()
      }
      if (req.method === 'DELETE') {
        objects.delete(key)
        res.writeHead(204)
        return res.end()
      }
      if (req.method === 'GET') {
        const prefix = url.searchParams.get('prefix') ?? ''
        const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort()
        const xml =
          '<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>' +
          `<IsTruncated>false</IsTruncated><KeyCount>${keys.length}</KeyCount>` +
          keys
            .map((k) => {
              const o = objects.get(k)!
              return `<Contents><Key>${k}</Key><LastModified>${o.lastModified.toISOString()}</LastModified><Size>${o.body.length}</Size></Contents>`
            })
            .join('') +
          '</ListBucketResult>'
        res.writeHead(200, { 'content-type': 'application/xml' })
        return res.end(xml)
      }
      res.writeHead(405)
      res.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    endpoint: `http://127.0.0.1:${port}`,
    objects,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
