// In-memory fake of the Cloudflare API endpoints infra/cloudflare.sh uses. Tests point the script
// at it with CLOUDFLARE_API_BASE, so nothing ever reaches the real API.
import http from 'node:http'
import type { AddressInfo } from 'node:net'

export const TOKEN = 'test-token'
export const ZONE = 'zone123'
export const ACCOUNT = 'acct456'

export type Write = { method: string; path: string; body: unknown }

export type MockState = {
  zoneSettings: Record<string, string>
  botFightMode: boolean
  rumSites: { site_tag: string; host: string; auto_install: boolean }[]
  rumForbidden: boolean
  cacheRules: unknown[] | null
  buckets: string[]
  customDomains: Record<string, { domain: string }[]>
  cors: Record<string, unknown[]>
  lifecycle: Record<string, unknown[]>
  locks: Record<string, unknown[]>
}

const driftedState = (): MockState => ({
  zoneSettings: {
    ssl: 'full',
    rocket_loader: 'on',
    email_obfuscation: 'on',
    always_online: 'on',
  },
  botFightMode: true,
  rumSites: [{ site_tag: 'tag1', host: 'atlas.studio', auto_install: true }],
  rumForbidden: false,
  cacheRules: null,
  buckets: [],
  customDomains: {},
  cors: {},
  lifecycle: {},
  locks: {},
})

export const startMock = async () => {
  const state = driftedState()
  const writes: Write[] = []
  const reads: string[] = []

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const p = new URL(req.url ?? '/', 'http://mock').pathname
      const method = req.method ?? 'GET'
      const raw = Buffer.concat(chunks).toString()
      const body: unknown = raw ? JSON.parse(raw) : undefined
      const send = (status: number, result: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify(
            status < 300
              ? { success: true, errors: [], result }
              : { success: false, errors: [{ code: status, message: 'nope' }], result: null },
          ),
        )
      }
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(403, null)
      if (method === 'GET') reads.push(p)
      else writes.push({ method, path: p, body })

      const bucketRoute = (suffix: string) =>
        p.match(new RegExp(`^/accounts/${ACCOUNT}/r2/buckets/([\\w-]+)/${suffix}$`))
      let m: RegExpMatchArray | null
      if ((m = p.match(new RegExp(`^/zones/${ZONE}/settings/(\\w+)$`)))) {
        const id = m[1] ?? ''
        if (method === 'GET') return send(200, { id, value: state.zoneSettings[id] })
        state.zoneSettings[id] = (body as { value: string }).value
        return send(200, { id, value: state.zoneSettings[id] })
      }
      if (p === `/zones/${ZONE}/bot_management`) {
        if (method === 'GET') return send(200, { fight_mode: state.botFightMode })
        state.botFightMode = (body as { fight_mode: boolean }).fight_mode
        return send(200, { fight_mode: state.botFightMode })
      }
      if (p === `/accounts/${ACCOUNT}/rum/site_info/list`) {
        if (state.rumForbidden) return send(403, null)
        return send(200, state.rumSites)
      }
      if (
        method === 'PUT' &&
        (m = p.match(new RegExp(`^/accounts/${ACCOUNT}/rum/site_info/(\\w+)$`)))
      ) {
        const site = state.rumSites.find((s) => s.site_tag === m![1])!
        site.auto_install = (body as { auto_install: boolean }).auto_install
        return send(200, site)
      }
      if (p === `/zones/${ZONE}/rulesets/phases/http_request_cache_settings/entrypoint`) {
        if (method === 'GET') {
          if (!state.cacheRules) return send(404, null)
          // Real responses add server-side fields; the script must ignore them.
          return send(200, {
            id: 'rs1',
            rules: (state.cacheRules as object[]).map((r, i) => ({
              ...r,
              id: `r${i}`,
              version: '1',
              last_updated: 'x',
            })),
          })
        }
        state.cacheRules = (body as { rules: unknown[] }).rules
        return send(200, { id: 'rs1', rules: state.cacheRules })
      }
      if (p === `/accounts/${ACCOUNT}/r2/buckets`) {
        if (method === 'GET') return send(200, { buckets: state.buckets.map((name) => ({ name })) })
        state.buckets.push((body as { name: string }).name)
        return send(200, body)
      }
      if ((m = bucketRoute('domains/custom'))) {
        const b = m[1] ?? ''
        if (!state.buckets.includes(b)) return send(404, null)
        if (method === 'GET') return send(200, { domains: state.customDomains[b] ?? [] })
        ;(state.customDomains[b] ??= []).push({ domain: (body as { domain: string }).domain })
        return send(200, body)
      }
      if ((m = bucketRoute('cors'))) {
        const b = m[1] ?? ''
        if (!state.buckets.includes(b)) return send(404, null)
        if (method === 'GET') return send(200, { rules: state.cors[b] ?? [] })
        state.cors[b] = (body as { rules: unknown[] }).rules
        return send(200, {})
      }
      if ((m = bucketRoute('lifecycle'))) {
        const b = m[1] ?? ''
        if (!state.buckets.includes(b)) return send(404, null)
        if (method === 'GET') return send(200, { rules: state.lifecycle[b] ?? [] })
        state.lifecycle[b] = (body as { rules: unknown[] }).rules
        return send(200, {})
      }
      if ((m = bucketRoute('lock'))) {
        const b = m[1] ?? ''
        if (!state.buckets.includes(b)) return send(404, null)
        if (method === 'GET') return send(200, { rules: state.locks[b] ?? [] })
        state.locks[b] = (body as { rules: unknown[] }).rules
        return send(200, {})
      }
      return send(404, null)
    })
  })

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  return {
    base: `http://127.0.0.1:${port}`,
    state,
    writes,
    reads,
    close: () => new Promise<void>((r) => server.close(() => r())),
  }
}
