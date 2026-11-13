// Runs the command on a scratch git repository: the template's state (nothing heavy) passes, and a
// deliberately broken fixture (a heavy image, a heavy video, an unreadable image) fails with each
// file named.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ASSET_BUDGET } from './assets-budget.ts'

const script = path.join(import.meta.dirname, 'check-assets.ts')
let repo: string

const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
const track = (relative: string, bytes: Uint8Array | Buffer) => {
  const file = path.join(repo, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, bytes)
  git('add', relative)
}
const run = () => spawnSync('node', [script, repo], { encoding: 'utf8' })

/** A PNG header of the given width, padded to `size` bytes. */
const png = (width: number, size = 64) => {
  const bytes = Buffer.alloc(size)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes)
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(10, 20)
  return bytes
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'check-assets-'))
  git('init', '-q')
})
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }))

describe('pnpm check:assets', () => {
  it('passes a repository with light assets, with a name that has spaces, and with none', () => {
    expect(run().status).toBe(0)
    track('apps/web/public/hero image.png', png(1600, 4096))
    track('apps/web/public/logo.svg', Buffer.alloc(5 * 1024 * 1024))
    const result = run()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('all within budget')
  })

  it('fails on a heavy image, a wide image, a heavy video and an unreadable image, naming each', () => {
    track('apps/web/public/heavy.png', png(800, ASSET_BUDGET.imageBytes + 1))
    track('apps/web/public/wide.png', png(ASSET_BUDGET.imageWidth + 1))
    track('apps/web/public/loop.mp4', Buffer.alloc(ASSET_BUDGET.videoBytes + 1))
    track('apps/web/public/broken.jpg', Buffer.from('not an image'))
    const result = run()
    expect(result.status).toBe(1)
    for (const name of ['heavy.png', 'wide.png', 'loop.mp4', 'broken.jpg']) {
      expect(result.stderr, name).toContain(name)
    }
  })

  it('does not weigh an untracked file', () => {
    fs.writeFileSync(path.join(repo, 'scratch.png'), png(ASSET_BUDGET.imageWidth + 1))
    expect(run().status).toBe(0)
  })

  it('fails outside a git repository instead of passing on nothing', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'check-assets-bare-'))
    try {
      const result = spawnSync('node', [script, bare], { encoding: 'utf8' })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('git')
    } finally {
      fs.rmSync(bare, { recursive: true, force: true })
    }
  })
})
