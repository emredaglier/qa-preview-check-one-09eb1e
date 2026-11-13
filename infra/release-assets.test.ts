import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { S3Client } from '@aws-sdk/client-s3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pruneReleases, uploadRelease } from './release-assets'
import { startS3Stub } from './s3-stub'

const DAY = 86_400_000
let stub: Awaited<ReturnType<typeof startS3Stub>>
let client: S3Client
let dir: string

beforeEach(async () => {
  stub = await startS3Stub()
  client = new S3Client({
    endpoint: stub.endpoint,
    region: 'auto',
    forcePathStyle: true,
    credentials: { accessKeyId: 'k', secretAccessKey: 's' },
  })
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-static-'))
})
afterEach(async () => {
  await stub.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

const write = (rel: string, body = 'x') => {
  const file = path.join(dir, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, body)
}
const seed = (release: string, ageDays: number, now: Date) => {
  stub.objects.set(`releases/${release}/_next/static/a.js`, {
    body: Buffer.from('x'),
    headers: {},
    lastModified: new Date(now.getTime() - ageDays * DAY),
  })
}
const releasesLeft = () =>
  [
    ...new Set(
      [...stub.objects.keys()].filter((k) => k.startsWith('releases/')).map((k) => k.split('/')[1]),
    ),
  ].sort()
const other = () =>
  stub.objects.set('media/photo.webp', {
    body: Buffer.from('p'),
    headers: {},
    lastModified: new Date(0),
  })

describe('uploadRelease', () => {
  it('uploads under releases/<sha>/_next/static with immutable headers and content types', async () => {
    write('chunks/app.js')
    write('css/app.css')
    write('media/font.woff2')
    write('chunks/app.js.map')
    await uploadRelease({ client, bucket: 'b', dir, release: 'abc123' })
    const get = (k: string) => stub.objects.get(`releases/abc123/_next/static/${k}`)
    expect(get('chunks/app.js')?.headers['content-type']).toBe('text/javascript; charset=utf-8')
    expect(get('css/app.css')?.headers['content-type']).toBe('text/css; charset=utf-8')
    expect(get('media/font.woff2')?.headers['content-type']).toBe('font/woff2')
    expect(get('chunks/app.js.map')?.headers['content-type']).toBe('application/json')
    for (const o of stub.objects.values()) {
      expect(o.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    }
    expect(stub.objects.size).toBe(4)
  })

  it('never deletes, even when other releases and stray objects exist', async () => {
    write('a.js')
    seed('old', 100, new Date())
    other()
    await uploadRelease({ client, bucket: 'b', dir, release: 'new' })
    expect(stub.requests.filter((r) => r.method === 'DELETE')).toEqual([])
    expect(releasesLeft()).toEqual(['new', 'old'])
    expect(stub.objects.has('media/photo.webp')).toBe(true)
  })

  it('refuses an empty directory and an unsafe release name', async () => {
    await expect(uploadRelease({ client, bucket: 'b', dir, release: 'abc' })).rejects.toThrow(
      /no files/i,
    )
    write('a.js')
    await expect(uploadRelease({ client, bucket: 'b', dir, release: '../x' })).rejects.toThrow(
      /release/i,
    )
    expect(stub.objects.size).toBe(0)
  })
})

describe('pruneReleases', () => {
  const now = new Date('2026-10-30T00:00:00Z')

  it('removes only releases older than 30 days, keeping the live ones whatever their age', async () => {
    seed('r1', 200, now)
    seed('r2', 100, now)
    seed('r3', 90, now) // previous live: old but kept
    seed('r4', 80, now) // live: old but kept
    const res = await pruneReleases({ client, bucket: 'b', now, keep: ['r3', 'r4'] })
    expect(res.deleted.sort()).toEqual(['r1', 'r2'])
    expect(releasesLeft()).toEqual(['r3', 'r4'])
  })

  it('keeps recent releases and leaves other prefixes alone', async () => {
    seed('r1', 100, now)
    seed('r2', 10, now)
    seed('r3', 5, now)
    seed('r4', 1, now)
    other()
    const res = await pruneReleases({ client, bucket: 'b', now, keep: ['r3', 'r4'] })
    expect(res.deleted).toEqual(['r1'])
    expect(releasesLeft()).toEqual(['r2', 'r3', 'r4'])
    expect(stub.objects.has('media/photo.webp')).toBe(true)
  })

  it('keeps the previous LIVE release, not the newest uploaded one, after a failed deploy', async () => {
    // A was live; B was uploaded, failed its checks and rolled back to A; then C went live.
    seed('A', 45, now)
    seed('B', 40, now) // newer upload than A, but never live
    seed('C', 0, now)
    const res = await pruneReleases({ client, bucket: 'b', now, keep: ['A', 'C'] })
    expect(res.deleted).toEqual(['B'])
    expect(releasesLeft()).toEqual(['A', 'C'])
  })

  it('a dry run deletes nothing', async () => {
    seed('r1', 100, now)
    seed('r2', 99, now)
    const dry = await pruneReleases({ client, bucket: 'b', now, keep: ['r2'], dryRun: true })
    expect(dry.deleted).toEqual(['r1'])
    expect(stub.requests.filter((r) => r.method === 'DELETE')).toEqual([])
  })

  it('refuses to prune without releases to keep, or with an unsafe name', async () => {
    seed('r1', 100, now)
    await expect(pruneReleases({ client, bucket: 'b', now, keep: [] })).rejects.toThrow(/keep/)
    await expect(pruneReleases({ client, bucket: 'b', now, keep: ['../x'] })).rejects.toThrow(
      /release/i,
    )
    expect(releasesLeft()).toEqual(['r1'])
  })
})
