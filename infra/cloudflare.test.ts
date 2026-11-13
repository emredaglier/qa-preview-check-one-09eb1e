import { spawn } from 'node:child_process'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ACCOUNT, TOKEN, ZONE, startMock } from './cloudflare-mock'

const script = path.resolve(import.meta.dirname, 'cloudflare.sh')

let mock: Awaited<ReturnType<typeof startMock>>

const run = (args: string[], env: Record<string, string> = {}) =>
  new Promise<{ code: number | null; out: string }>((resolve) => {
    const child = spawn('bash', [script, ...args], {
      env: {
        PATH: process.env.PATH ?? '',
        TMPDIR: process.env.TMPDIR ?? '',
        CLOUDFLARE_API_BASE: mock.base,
        CLOUDFLARE_API_TOKEN: TOKEN,
        CLOUDFLARE_ZONE_ID: ZONE,
        CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
        // The names come from infra/project.env; the environment wins over the file.
        PROJECT_NAME: 'atlas',
        DOMAIN: 'atlas.studio',
        ...env,
      },
    })
    let out = ''
    child.stdout.on('data', (d: Buffer) => (out += d))
    child.stderr.on('data', (d: Buffer) => (out += d))
    child.on('close', (code) => resolve({ code, out }))
  })

beforeEach(async () => {
  mock = await startMock()
})
afterEach(async () => {
  await mock.close()
})

describe('infra/cloudflare.sh', () => {
  it('refuses the template placeholder domain against the real API', async () => {
    const { code, out } = await run([], { DOMAIN: 'example.com', CLOUDFLARE_API_BASE: '' })
    expect(code).not.toBe(0)
    expect(out).toContain('project.env')
    expect(mock.writes).toEqual([])
  })

  it('plan mode (the default) reports changes and makes no writes', async () => {
    const { code, out } = await run([])
    expect(code).toBe(0)
    expect(mock.writes).toEqual([])
    expect(out).toContain('PLAN')
    expect(out).toMatch(/\d+ change\(s\) planned/)
    expect(out).toContain('--apply')
  })

  it('a 403 on the Web Analytics site list is a warning, and the rest of the plan still runs', async () => {
    mock.state.rumForbidden = true
    const { code, out } = await run([])
    expect(code).toBe(0)
    expect(out).toContain('WARN     Web Analytics auto-injection')
    expect(out).toContain('PLAN     Bot Fight Mode')
  })

  it('apply sends the expected zone, analytics, cache rule and R2 payloads', async () => {
    const { code } = await run(['--apply'])
    expect(code).toBe(0)
    const w = (method: string, p: string) =>
      mock.writes.find((x) => x.method === method && x.path === p)?.body
    const z = `/zones/${ZONE}`
    expect(w('PATCH', `${z}/settings/ssl`)).toEqual({ value: 'strict' })
    expect(w('PATCH', `${z}/settings/rocket_loader`)).toEqual({ value: 'off' })
    expect(w('PATCH', `${z}/settings/email_obfuscation`)).toEqual({ value: 'off' })
    expect(w('PATCH', `${z}/settings/always_online`)).toEqual({ value: 'off' })
    expect(w('PUT', `${z}/bot_management`)).toEqual({ fight_mode: false })
    expect(w('PUT', `/accounts/${ACCOUNT}/rum/site_info/tag1`)).toMatchObject({
      auto_install: false,
    })

    const rules = (
      w('PUT', `${z}/rulesets/phases/http_request_cache_settings/entrypoint`) as {
        rules: { expression: string; action: string; action_parameters: unknown }[]
      }
    ).rules
    expect(rules).toHaveLength(2)
    expect(rules[0]?.expression).toBe('(http.host eq "cdn.atlas.studio")')
    expect(rules[0]?.action_parameters).toEqual({
      cache: true,
      edge_ttl: { mode: 'respect_origin' },
      browser_ttl: { mode: 'respect_origin' },
    })
    expect(rules[1]?.expression).toContain('"atlas.studio"')
    expect(rules[1]?.action_parameters).toEqual({ cache: false })

    expect([...mock.state.buckets].sort()).toEqual([
      'atlas-backup',
      'atlas-db-backups',
      'atlas-media',
    ])
    expect(mock.state.customDomains['atlas-media']).toEqual([{ domain: 'cdn.atlas.studio' }])
    expect(mock.state.customDomains['atlas-db-backups']).toBeUndefined()
    expect(mock.state.customDomains['atlas-backup']).toBeUndefined()
    const cors = mock.state.cors['atlas-media'] as {
      allowed: { origins: string[]; methods: string[] }
    }[]
    expect(cors[0]?.allowed.origins).toEqual(['https://atlas.studio', 'https://www.atlas.studio'])
    expect(cors[0]?.allowed.methods).toEqual(['GET', 'HEAD'])
    expect(mock.state.cors['atlas-db-backups']).toBeUndefined()
  })

  it('plans, then applies, a 30-day expiry for the trash prefix on the media bucket only', async () => {
    const plan = await run([])
    expect(plan.out).toMatch(/PLAN\s+R2 atlas-media: lifecycle rule.*trash\//)

    await run(['--apply'])
    expect(mock.state.lifecycle['atlas-media']).toEqual([
      {
        id: 'expire-trash-after-30-days',
        enabled: true,
        conditions: { prefix: 'trash/' },
        deleteObjectsTransition: { condition: { type: 'Age', maxAge: 30 * 24 * 60 * 60 } },
      },
    ])
    // The backup bucket never gets a delete rule.
    expect(mock.state.lifecycle['atlas-backup']).toBeUndefined()
    expect(mock.state.lifecycle['atlas-db-backups']).toBeUndefined()
  })

  it('locks the backup bucket indefinitely and nothing else', async () => {
    await run(['--apply'])
    expect(mock.state.locks['atlas-backup']).toEqual([
      { id: 'never-delete', enabled: true, prefix: '', condition: { type: 'Indefinite' } },
    ])
    expect(mock.state.locks['atlas-media']).toBeUndefined()
    expect(mock.state.locks['atlas-db-backups']).toBeUndefined()
  })

  it('replaces a drifted lifecycle rule', async () => {
    await run(['--apply'])
    mock.writes.length = 0
    mock.state.lifecycle['atlas-media'] = [
      {
        id: 'expire-trash-after-30-days',
        enabled: true,
        conditions: { prefix: 'trash/' },
        deleteObjectsTransition: { condition: { type: 'Age', maxAge: 999 } },
      },
    ]
    await run(['--apply'])
    expect(mock.writes.map((x) => `${x.method} ${x.path}`)).toEqual([
      `PUT /accounts/${ACCOUNT}/r2/buckets/atlas-media/lifecycle`,
    ])
  })

  it('a second run plans nothing', async () => {
    await run(['--apply'])
    mock.writes.length = 0
    const { code, out } = await run([])
    expect(code).toBe(0)
    expect(out).toContain('0 change(s) planned')
    expect(out).not.toContain('PLAN')
    const again = await run(['--apply'])
    expect(again.code).toBe(0)
    expect(mock.writes).toEqual([])
  })

  it('only changes what drifted', async () => {
    await run(['--apply'])
    mock.writes.length = 0
    mock.state.zoneSettings.rocket_loader = 'on'
    await run(['--apply'])
    expect(mock.writes.map((x) => `${x.method} ${x.path}`)).toEqual([
      `PATCH /zones/${ZONE}/settings/rocket_loader`,
    ])
  })

  it('refuses to run without credentials, before any request', async () => {
    const { code, out } = await run([], { CLOUDFLARE_API_TOKEN: '' })
    expect(code).not.toBe(0)
    expect(out).toContain('CLOUDFLARE_API_TOKEN')
    expect(mock.reads).toEqual([])
  })

  it('stops with an error when the API rejects the token', async () => {
    const { code, out } = await run(['--apply'], { CLOUDFLARE_API_TOKEN: 'wrong' })
    expect(code).not.toBe(0)
    expect(out).toContain('403')
    expect(mock.writes).toEqual([])
  })

  it('rejects unknown arguments', async () => {
    const { code } = await run(['--bogus'])
    expect(code).not.toBe(0)
  })
})
