/**
 * Static assets of each release on the CDN (ADR-0005).
 *
 *   node infra/release-assets.ts upload --dir <.next/static dir> --release <sha>
 *   node infra/release-assets.ts prune --keep <live sha>[,<previous live sha>] [--max-age-days 30] [--dry-run]
 *
 * Env (same names as cms): S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
 * optional S3_REGION (default auto) and S3_FORCE_PATH_STYLE=true (MinIO).
 *
 * `upload` only ever PUTs. `prune` is the only code that deletes, and only whole releases.
 * Run from Node 24 directly (types are stripped); it imports the AWS SDK and ./settings.ts.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

import { RELEASE_NAME_PATTERN } from './settings.ts'

export const RELEASES_PREFIX = 'releases/'
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'
const DAY_MS = 86_400_000

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
}

function assertRelease(release: string) {
  if (!RELEASE_NAME_PATTERN.test(release)) throw new Error(`Invalid release name: ${release}`)
}

function walk(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    return e.isDirectory()
      ? walk(full, base)
      : [path.relative(base, full).split(path.sep).join('/')]
  })
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: Math.min(size, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item)
    }),
  )
}

/** Uploads `dir` (a built `.next/static`) to `releases/<release>/_next/static/`. Never deletes. */
export async function uploadRelease(opts: {
  client: S3Client
  bucket: string
  dir: string
  release: string
}) {
  assertRelease(opts.release)
  const files = fs.existsSync(opts.dir) ? walk(opts.dir) : []
  if (files.length === 0) throw new Error(`No files found in ${opts.dir}`)
  await pool(files, 8, async (rel) => {
    await opts.client.send(
      new PutObjectCommand({
        Bucket: opts.bucket,
        Key: `${RELEASES_PREFIX}${opts.release}/_next/static/${rel}`,
        Body: fs.readFileSync(path.join(opts.dir, rel)),
        ContentType: CONTENT_TYPES[path.extname(rel).toLowerCase()] ?? 'application/octet-stream',
        CacheControl: IMMUTABLE_CACHE_CONTROL,
      }),
    )
  })
  return { uploaded: files.length }
}

type Release = { name: string; keys: string[]; newest: number }

async function listReleases(client: S3Client, bucket: string): Promise<Release[]> {
  const byName = new Map<string, Release>()
  let token: string | undefined
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: RELEASES_PREFIX,
        ContinuationToken: token,
      }),
    )
    for (const o of page.Contents ?? []) {
      if (!o.Key) continue
      const name = o.Key.slice(RELEASES_PREFIX.length).split('/')[0]
      if (!name) continue
      const r = byName.get(name) ?? { name, keys: [], newest: 0 }
      r.keys.push(o.Key)
      r.newest = Math.max(r.newest, o.LastModified?.getTime() ?? 0)
      byName.set(name, r)
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
  return [...byName.values()]
}

/**
 * Deletes releases whose newest object is older than `maxAgeDays`, except those in `keep`
 * whatever their age (a lifecycle rule would expire a live release after 30 quiet days). `keep`
 * is the live release and the previous LIVE one, read from the deploy history
 * (`deploy.sh live-releases`): the newest upload is not necessarily a release that ever went live
 * (it may have failed and rolled back), so this never guesses from upload times. Only keys under
 * `releases/` are touched.
 */
export async function pruneReleases(opts: {
  client: S3Client
  bucket: string
  keep: string[]
  now?: Date
  maxAgeDays?: number
  dryRun?: boolean
}) {
  if (opts.keep.length === 0) throw new Error('prune needs the releases to keep (--keep)')
  opts.keep.forEach(assertRelease)
  const now = (opts.now ?? new Date()).getTime()
  const maxAge = (opts.maxAgeDays ?? 30) * DAY_MS
  const releases = (await listReleases(opts.client, opts.bucket)).sort(
    (a, b) => b.newest - a.newest,
  )
  const keep = new Set(opts.keep)
  const doomed = releases.filter((r) => !keep.has(r.name) && now - r.newest > maxAge)
  if (!opts.dryRun) {
    for (const r of doomed) {
      await pool(r.keys, 8, async (Key) => {
        await opts.client.send(new DeleteObjectCommand({ Bucket: opts.bucket, Key }))
      })
    }
  }
  return {
    deleted: doomed.map((r) => r.name),
    kept: releases.filter((r) => !doomed.includes(r)).map((r) => r.name),
  }
}

function clientFromEnv(env = process.env) {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = env
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    throw new Error('Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.')
  }
  return {
    bucket: S3_BUCKET,
    client: new S3Client({
      endpoint: S3_ENDPOINT,
      region: env.S3_REGION || 'auto',
      forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
      credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
    }),
  }
}

async function main(argv: string[]) {
  const [cmd, ...rest] = argv
  const flags = new Map<string, string>()
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!
    if (!a.startsWith('--')) throw new Error(`Unexpected argument: ${a}`)
    const next = rest[i + 1]
    if (next === undefined || next.startsWith('--')) flags.set(a, 'true')
    else {
      flags.set(a, next)
      i++
    }
  }
  const { client, bucket } = clientFromEnv()
  if (cmd === 'upload') {
    const dir = flags.get('--dir')
    const release = flags.get('--release')
    if (!dir || !release) throw new Error('upload needs --dir and --release')
    const { uploaded } = await uploadRelease({ client, bucket, dir, release })
    console.log(`uploaded ${uploaded} files to releases/${release}/`)
  } else if (cmd === 'prune') {
    const keep = (flags.get('--keep') ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
    const res = await pruneReleases({
      client,
      bucket,
      keep,
      maxAgeDays: flags.has('--max-age-days') ? Number(flags.get('--max-age-days')) : undefined,
      dryRun: flags.has('--dry-run'),
    })
    console.log(
      `${flags.has('--dry-run') ? 'would delete' : 'deleted'}: ${res.deleted.join(' ') || '(none)'}`,
    )
    console.log(`kept: ${res.kept.join(' ') || '(none)'}`)
  } else {
    throw new Error(
      'Usage: release-assets.ts upload --dir D --release SHA | prune --keep SHA[,SHA] [--dry-run]',
    )
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
