import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// macOS `mktemp` ignores TMPDIR when it gets no template, and a sandboxed agent may only write
// under its own TMPDIR. So every script that makes a temp file names a template under TMPDIR.
let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmpdir-test-'))
  const bin = path.join(dir, 'bin')
  fs.mkdirSync(bin)
  // A `mktemp` that records what it was asked for and fails, so each script stops right there.
  fs.writeFileSync(
    path.join(bin, 'mktemp'),
    `#!/bin/sh\necho "$*" >> "${dir}/mktemp.log"\nexit 1\n`,
    {
      mode: 0o755,
    },
  )
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const names = { PROJECT_NAME: 'atlas', DOMAIN: 'atlas.studio' }
const scripts: Record<string, { args: string[]; env: Record<string, string> }> = {
  'cloudflare.sh': {
    args: [],
    env: {
      CLOUDFLARE_API_BASE: 'http://127.0.0.1:9',
      CLOUDFLARE_API_TOKEN: 't',
      CLOUDFLARE_ZONE_ID: 'z',
      CLOUDFLARE_ACCOUNT_ID: 'a',
    },
  },
  'smoke.sh': { args: ['http://127.0.0.1:9'], env: {} },
  'assets.sh': { args: ['upload', 'image', 'v1.2.3'], env: {} },
  'ci.sh': {
    args: ['deploy', 'v1.2.3'],
    env: {
      R2_ACCOUNT_ID: 'a',
      R2_MEDIA_WRITE_KEY_ID: 'k',
      R2_MEDIA_WRITE_SECRET: 's',
      DEPLOY_HOST: 'h',
      DEPLOY_USER: 'u',
      DEPLOY_SSH_KEY: 'key',
      DEPLOY_HOST_KEY: 'hostkey',
    },
  },
}

describe('scripts that make temp files', () => {
  it.each(Object.entries(scripts))('%s makes them under TMPDIR', (name, { args, env }) => {
    const tmp = path.join(dir, 'scratch')
    spawnSync('bash', [path.resolve(import.meta.dirname, name), ...args], {
      env: { PATH: `${dir}/bin:${process.env.PATH ?? ''}`, TMPDIR: tmp, ...names, ...env },
      timeout: 10_000,
    })
    const asked = fs.readFileSync(path.join(dir, 'mktemp.log'), 'utf8').trim()
    expect(asked.split(' ').at(-1)?.startsWith(`${tmp}/`), asked).toBe(true)
  })
})
