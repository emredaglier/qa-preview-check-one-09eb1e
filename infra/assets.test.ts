import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startS3Stub } from './s3-stub'

const script = path.resolve(import.meta.dirname, 'assets.sh')
// A timeout, because a half-quit Docker Desktop leaves `docker info` hanging instead of failing.
const hasDocker = spawnSync('docker', ['info'], { stdio: 'ignore', timeout: 5000 }).status === 0

let stub: Awaited<ReturnType<typeof startS3Stub>>
beforeEach(async () => {
  stub = await startS3Stub()
})
afterEach(async () => {
  await stub.close()
})

const run = (args: string[]) =>
  new Promise<{ code: number | null; out: string }>((resolve) => {
    const child = spawn('bash', [script, ...args], {
      env: {
        PATH: process.env.PATH ?? '',
        TMPDIR: process.env.TMPDIR ?? '',
        S3_ENDPOINT: stub.endpoint,
        S3_BUCKET: 'bucket',
        S3_ACCESS_KEY_ID: 'k',
        S3_SECRET_ACCESS_KEY: 's',
        S3_FORCE_PATH_STYLE: 'true',
        // Names come from infra/project.env; the environment wins over the file.
        PROJECT_NAME: 'atlas',
        DOMAIN: 'atlas.studio',
      },
    })
    let out = ''
    child.stdout.on('data', (d: Buffer) => (out += d))
    child.stderr.on('data', (d: Buffer) => (out += d))
    child.on('close', (code) => resolve({ code, out }))
  })

describe('infra/assets.sh', () => {
  it('prints the build args for a release', async () => {
    const { code, out } = await run(['build-args', 'abc123'])
    expect(code).toBe(0)
    expect(out.trim()).toBe(
      '--build-arg ASSET_PREFIX=https://cdn.atlas.studio/releases/abc123 --build-arg DEPLOYMENT_ID=abc123',
    )
  })

  it('prints the asset prefix of a release, the same one the build args carry', async () => {
    const prefix = await run(['asset-prefix', 'abc123'])
    expect(prefix.code).toBe(0)
    expect(prefix.out.trim()).toBe('https://cdn.atlas.studio/releases/abc123')
    const args = await run(['build-args', 'abc123'])
    expect(args.out).toContain(`ASSET_PREFIX=${prefix.out.trim()} `)
  })

  it('prune --dry-run lists releases without deleting', async () => {
    stub.objects.set('releases/old/_next/static/a.js', {
      body: Buffer.from('x'),
      headers: {},
      lastModified: new Date(0),
    })
    const { code, out } = await run(['prune', '--keep', 'old', '--dry-run'])
    expect(code).toBe(0)
    expect(out).toContain('kept: old')
    expect(stub.requests.some((r) => r.method === 'DELETE')).toBe(false)
  })

  it('prune refuses to run without --keep', async () => {
    const { code, out } = await run(['prune', '--dry-run'])
    expect(code).not.toBe(0)
    expect(out).toMatch(/--keep/)
  })

  it.skipIf(!hasDocker)(
    'extracts /_next/static from an image and uploads it',
    async () => {
      const ctx = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-img-'))
      const tag = `assets-test:${process.pid}`
      try {
        fs.mkdirSync(path.join(ctx, 'static/chunks'), { recursive: true })
        fs.writeFileSync(path.join(ctx, 'static/chunks/a.js'), 'console.log(1)')
        fs.writeFileSync(
          path.join(ctx, 'Dockerfile'),
          'FROM scratch\nCOPY static /app/apps/web/.next/static\nCMD ["/x"]\n',
        )
        const build = spawnSync('docker', ['build', '-q', '-t', tag, ctx], { encoding: 'utf8' })
        expect(build.status, build.stderr).toBe(0)
        const { code, out } = await run(['upload', tag, 'abc123'])
        expect(code, out).toBe(0)
        const o = stub.objects.get('releases/abc123/_next/static/chunks/a.js')
        expect(o?.body.toString()).toBe('console.log(1)')
        expect(o?.headers['cache-control']).toBe('public, max-age=31536000, immutable')
        expect(stub.requests.some((r) => r.method === 'DELETE')).toBe(false)
      } finally {
        spawnSync('docker', ['rmi', '-f', tag], { stdio: 'ignore' })
        fs.rmSync(ctx, { recursive: true, force: true })
      }
    },
    60_000,
  )
})
