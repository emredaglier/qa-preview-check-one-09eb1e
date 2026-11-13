import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildSiteConfig } from '../config'
import { PLACEHOLDER_SITE } from './placeholder'
import { runSeed } from './seed'

let dir: string
let payload: Payload

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'house-seed-'))
  payload = await getPayload({
    config: await buildSiteConfig({
      role: 'cms',
      databasePath: path.join(dir, 'seed.db'),
      secret: 'test-secret',
      push: false,
    }),
  })
  await payload.db.migrate()
}, 30_000)

afterAll(async () => {
  await payload?.db.destroy?.()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('runSeed', () => {
  it('fills the Site global, then leaves it alone on a second run', async () => {
    expect(await runSeed(payload)).toEqual({ site: 'seeded' })
    const site = await payload.findGlobal({ slug: 'site', depth: 0 })
    expect(site.name).toBe(PLACEHOLDER_SITE.name)
    expect(site.intro).toBe(PLACEHOLDER_SITE.intro)
    expect(await runSeed(payload)).toEqual({ site: 'unchanged' })
  })

  it('refuses to overwrite an edited global unless forced', async () => {
    await payload.updateGlobal({ slug: 'site', data: { name: 'Edited in the admin' } })
    expect(await runSeed(payload)).toEqual({ site: 'edited' })
    expect((await payload.findGlobal({ slug: 'site', depth: 0 })).name).toBe('Edited in the admin')
    expect(await runSeed(payload, { force: true })).toEqual({ site: 'overwritten' })
    expect((await payload.findGlobal({ slug: 'site', depth: 0 })).name).toBe(PLACEHOLDER_SITE.name)
  })
})
