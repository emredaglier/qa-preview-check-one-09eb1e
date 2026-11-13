import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { Client } from '@libsql/client'
import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildSiteConfig } from './config'

let dir: string
let cms: Payload
let web: Payload

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'house-readonly-'))
  const databasePath = path.join(dir, 'site.db')
  cms = await getPayload({
    key: 'cms',
    config: await buildSiteConfig({ role: 'cms', databasePath, secret: 's', push: false }),
  })
  await cms.db.migrate()
  await cms.updateGlobal({ slug: 'site', data: { name: 'Written by cms' } })
  web = await getPayload({
    key: 'web',
    config: await buildSiteConfig({ role: 'web', databasePath, secret: 's' }),
  })
}, 30_000)

afterAll(async () => {
  await web?.db.destroy?.()
  await cms?.db.destroy?.()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('the web role', () => {
  it('reads what cms wrote, through its own connection', async () => {
    expect((await web.findGlobal({ slug: 'site' })).name).toBe('Written by cms')
  })

  it('fails any write through its DB connection', async () => {
    const client = (web.db as unknown as { client: Client }).client
    await expect(client.execute("UPDATE site SET name = 'x'")).rejects.toThrow(/readonly/i)
    await expect(client.execute('DELETE FROM users')).rejects.toThrow(/readonly/i)
    await expect(client.execute('CREATE TABLE sneaky (id INTEGER)')).rejects.toThrow(/readonly/i)
  })

  it('fails a Local API write even with access rules bypassed', async () => {
    await expect(web.updateGlobal({ slug: 'site', data: { name: 'Hacked' } })).rejects.toThrow()
    expect((await cms.findGlobal({ slug: 'site' })).name).toBe('Written by cms')
  })

  it('builds the config again in one process without throwing (a shared global is not mutated)', async () => {
    for (let i = 0; i < 3; i++) {
      await buildSiteConfig({ role: 'web', databasePath: path.join(dir, 'site.db'), secret: 's' })
    }
  })
})
