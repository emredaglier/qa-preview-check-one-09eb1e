// `pnpm smoke`: the release gate (ADR-0005). One command, headless, exit code 0/1.
//
//   1. migrate a temp SQLite file and seed the placeholder content through the Local API
//   2. build the `web` image (unless SMOKE_WEB_IMAGE names one already built)
//   3. run that image against the temp database and wait for it to be healthy
//   4. warm the home page's cache, then save once through the Local API with the revalidate hook
//      pointing at the container (apps/cms/scripts/smoke-live-edit.ts)
//   5. run smoke/playwright.config.ts against it
//   6. clean up (container, temp files)
//
// Needs Docker and a Playwright Chromium (`pnpm exec playwright install chromium`). CI runs it on
// the image it just built (infra/ci.sh smoke); on a laptop it builds the image itself.
//
// Extra arguments go to `playwright test`, e.g. `pnpm smoke -g "no /admin"`. infra/ci.sh smoke
// passes `--grep-invert "check self-test"` for a release tag, which leaves out
// smoke/checks.selftest.spec.ts.
// Environment:
//   SMOKE_WEB_IMAGE     use this already built image instead of building one. Then also set
//                       SMOKE_ASSET_PREFIX to the prefix it was built with (empty if none).
//   SMOKE_ASSET_PREFIX  CDN prefix to build with (default: the CDN origin of infra/project.env).
//                       Its /_next/ requests are answered by the container inside the browser.
//   SMOKE_PLATFORM      docker build platform (default: native; CI sets linux/amd64)
//   SMOKE_PORT          publish the container on this host port (default: a free one)
//   SMOKE_RUNNER        a node script to run against the container instead of Playwright, with
//                       SMOKE_BASE_URL and SMOKE_OUTPUT_DIR set (the perf suite uses this). Its
//                       exit code is the result.
//   SMOKE_EXTRA_SECRETS a JSON array of strings the secrets-in-bundle spec must not find. To see
//                       that spec fail, name a string the page serves:
//                       SMOKE_EXTRA_SECRETS='["Opening hours"]' pnpm smoke -g "no server secret"
//   SMOKE_BUILT_FILES   set by this script, not by you: a JSON file listing every script and stylesheet
//                       of the image's `.next/static`, for the secrets-in-bundle spec
//   SMOKE_KEEP=1        keep the temp dir and container for debugging
//   SMOKE_OUTPUT_DIR    where traces, screenshots and the HTML report go (smoke/.output)
import { spawn, spawnSync, type SpawnOptions } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadSettings } from '../infra/settings.ts'
import { builtFilePaths } from './secrets-scan.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = process.env
const settings = loadSettings()
const prebuilt = env.SMOKE_WEB_IMAGE
const assetPrefix = prebuilt
  ? (env.SMOKE_ASSET_PREFIX ?? '')
  : (env.SMOKE_ASSET_PREFIX ?? settings.cdnOrigin)
const image = prebuilt ?? `${settings.projectName}-web:smoke`
const container = `${settings.projectName}-smoke-${process.pid}`
const SECRETS = {
  PAYLOAD_SECRET: 'smoke-only-cms-payload-secret',
  REVALIDATE_SECRET: 'smoke-only-revalidate-secret',
}
/** web never signs anything; its PAYLOAD_SECRET is its own, never the cms one. */
const WEB_PAYLOAD_SECRET = 'smoke-only-web-payload-secret'

/** Where the web image keeps its static files (infra/assets.sh reads the same folder). */
const STATIC_IN_IMAGE = '/app/apps/web/.next/static'

const log = (message: string) => console.log(`\n[smoke] ${message}`)

function run(command: string, args: string[], options: SpawnOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options })
    child.on('error', reject)
    child.on('exit', (status, signal) =>
      status === 0
        ? resolve()
        : reject(new Error(`${command} ${args.join(' ')} exited with ${status ?? signal}`)),
    )
  })
}

async function waitHealthy(url: string) {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`web container did not become healthy at ${url}`)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `${settings.projectName}-smoke-`))
let started = false
let exitCode = 1

try {
  const dataDir = path.join(tmp, 'data')
  fs.mkdirSync(dataDir)

  log('migrating and seeding the temp database (Local API)')
  const seedEnv = {
    ...env,
    ...SECRETS,
    DATABASE_PATH: path.join(dataDir, 'site.db'),
    NODE_ENV: 'production',
    // A production cms config refuses to load without it (CSRF); nothing is served here.
    CMS_ORIGINS: 'http://127.0.0.1',
  }
  // Workspaces are picked by folder, so renaming the @house scope needs no change here. The `--`
  // matters: `payload run` swallows the flags before it.
  await run('pnpm', ['--filter', './apps/cms', 'exec', 'payload', 'migrate'], { env: seedEnv })
  await run('pnpm', ['--filter', './apps/cms', 'exec', 'payload', 'run', 'scripts/seed.ts', '--'], {
    env: seedEnv,
  })
  // The container runs as uid 10001; the host files belong to whoever runs the gate.
  await run('chmod', ['-R', 'a+rwX', dataDir])

  if (!prebuilt) {
    log(`building the web image (asset prefix: ${assetPrefix || 'none'})`)
    await run('docker', [
      'build',
      '--target',
      'web',
      '--build-arg',
      `ASSET_PREFIX=${assetPrefix}`,
      // Production builds always carry both (infra/assets.sh build-args); the spec checks `?dpl=`.
      '--build-arg',
      'DEPLOYMENT_ID=smoke',
      ...(env.SMOKE_PLATFORM ? ['--platform', env.SMOKE_PLATFORM] : []),
      '-t',
      image,
      '.',
    ])
  }

  log('starting the web container')
  await run('docker', [
    'run',
    '--detach',
    '--name',
    container,
    '--publish',
    `127.0.0.1:${env.SMOKE_PORT ?? ''}:3000`,
    '--volume',
    `${dataDir}:/data`,
    '--env',
    'DATABASE_PATH=/data/site.db',
    '--env',
    `PAYLOAD_SECRET=${WEB_PAYLOAD_SECRET}`,
    '--env',
    `REVALIDATE_SECRET=${SECRETS.REVALIDATE_SECRET}`,
    image,
  ])
  started = true
  const portLine = spawnSync('docker', ['port', container, '3000/tcp'], { encoding: 'utf8' })
  const baseUrl = `http://127.0.0.1:${portLine.stdout.trim().split('\n')[0]!.split(':').pop()}`
  await waitHealthy(`${baseUrl}/internal/health`)

  // Every script and stylesheet the image holds, copied out of the running container (as
  // infra/assets.sh upload does). The secrets spec reads them all: a lazily loaded chunk has no link
  // in any page, so crawling from the pages alone would never reach it.
  log('listing the built scripts and stylesheets of the image')
  const staticDir = path.join(tmp, 'static')
  await run('docker', ['cp', `${container}:${STATIC_IN_IMAGE}/.`, staticDir])
  const builtFiles = builtFilePaths(
    (fs.readdirSync(staticDir, { recursive: true }) as string[])
      .filter((entry) => fs.statSync(path.join(staticDir, entry)).isFile())
      .map((entry) => entry.split(path.sep).join('/')),
  )
  if (builtFiles.length === 0) throw new Error(`no script or stylesheet in ${STATIC_IN_IMAGE}`)
  const builtFilesPath = path.join(tmp, 'built-files.json')
  fs.writeFileSync(builtFilesPath, JSON.stringify(builtFiles))

  // Cache the page the live edit changes, so only the revalidate hook can refresh it.
  log('warming the cache, then saving through the Local API (revalidate hook -> container)')
  await fetch(`${baseUrl}/`)
  await run(
    'pnpm',
    ['--filter', './apps/cms', 'exec', 'payload', 'run', 'scripts/smoke-live-edit.ts', '--'],
    { env: { ...seedEnv, REVALIDATE_URLS: `${baseUrl}/internal/revalidate` } },
  )

  log(`running the Playwright smoke test against ${baseUrl}`)
  const outputDir = env.SMOKE_OUTPUT_DIR ?? path.join(root, 'smoke/.output')
  const code = await new Promise<number>((resolve) => {
    const [command, args] = env.SMOKE_RUNNER
      ? ['node', [env.SMOKE_RUNNER, ...process.argv.slice(2)]]
      : [
          'pnpm',
          [
            'exec',
            'playwright',
            'test',
            '--config',
            'smoke/playwright.config.ts',
            ...process.argv.slice(2),
          ],
        ]
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...env,
        SMOKE_BASE_URL: baseUrl,
        SMOKE_REVALIDATE_SECRET: SECRETS.REVALIDATE_SECRET,
        // Every secret the gate's processes hold: the secrets-in-bundle spec looks for them in
        // everything the browser is served.
        SMOKE_SECRETS: JSON.stringify([
          ...Object.values(SECRETS),
          WEB_PAYLOAD_SECRET,
          ...(JSON.parse(env.SMOKE_EXTRA_SECRETS ?? '[]') as string[]),
        ]),
        SMOKE_BUILT_FILES: builtFilesPath,
        SMOKE_ASSET_PREFIX: assetPrefix,
        SMOKE_OUTPUT_DIR: outputDir,
      },
    })
    child.on('exit', (status) => resolve(status ?? 1))
  })
  exitCode = code
  if (code !== 0) {
    log(`FAILED. Traces and screenshots: ${outputDir}`)
    spawnSync('docker', ['logs', '--tail', '40', container], { stdio: 'inherit' })
  } else {
    log('PASSED')
  }
} catch (error) {
  console.error(`\n[smoke] ERROR: ${error instanceof Error ? error.message : String(error)}`)
  if (started) spawnSync('docker', ['logs', '--tail', '40', container], { stdio: 'inherit' })
} finally {
  if (env.SMOKE_KEEP === '1') {
    log(`kept: container ${container}, data in ${tmp}`)
  } else {
    if (started) spawnSync('docker', ['rm', '--force', container], { stdio: 'ignore' })
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
process.exit(exitCode)
