// infra/deploy.sh against a fake `docker` on PATH and the stub site (smoke checks + webhook).
// The real-Docker drill is infra/test/deploy-drill.sh.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startSiteStub } from './site-stub'

const script = path.resolve(import.meta.dirname, 'deploy.sh')

// Records every call as "RELEASE=<r> <args>". `up` makes RELEASE live (and tells the stub);
// FAKE_UNHEALTHY / FAKE_BAD_MIGRATE / FAKE_BAD_SNAPSHOT list tags that fail that step.
const fakeDocker = `#!/usr/bin/env bash
dir="$FAKE_DIR"
echo "RELEASE=\${RELEASE:-} $*" >>"$dir/calls"
has() { [[ " $1 " == *" $2 "* ]]; }
[[ "$1" == inspect ]] && { echo "atlas/web:$(cat "$dir/live")"; exit 0; }
[[ "$1" == compose ]] || exit 0
shift
case "$1" in
  config) printf 'migrate\\ncaddy\\nweb\\nweb-preview\\ncms\\n' ;;
  ps)
    if [[ "$*" == *litestream* ]]; then [[ -n "\${FAKE_LITESTREAM:-}" ]] && echo ls123; exit 0; fi
    [[ -s "$dir/live" ]] && echo cid123 ;;
  exec)
    [[ "$*" == *"litestream sync"* && -n "\${FAKE_BAD_SYNC:-}" ]] && exit 1
    [[ "$*" == *"caddy reload"* && -n "\${FAKE_BAD_RELOAD:-}" ]] && exit 1
    exit 0 ;;
  pull) exit 0 ;;
  run)
    if [[ "$*" == *"--entrypoint node"* ]]; then
      has "\${FAKE_BAD_SNAPSHOT:-}" "$RELEASE" && exit 1
      [[ "$*" == *"SNAPSHOT_NAME="* ]] && echo "snapshot ok"
      exit 0
    fi
    has "\${FAKE_BAD_MIGRATE:-}" "$RELEASE" && { echo "migration boom" >&2; exit 1; }
    exit 0 ;;
  up)
    echo "$RELEASE" >"$dir/live"
    # What the containers would mount: the folder Compose runs from, and its Caddy config.
    pwd >"$dir/up-cwd"
    if [[ -f caddy/Caddyfile ]]; then cat caddy/Caddyfile >"$dir/caddy-at-up"; fi
    curl -s -X PUT "$FAKE_STUB/__live/$RELEASE" >/dev/null
    has "\${FAKE_UNHEALTHY:-}" "$RELEASE" && { echo "container web is unhealthy" >&2; exit 1; }
    exit 0 ;;
esac
`

let site: Awaited<ReturnType<typeof startSiteStub>>
let dir: string

const run = (args: string[], env: Record<string, string> = {}, from = script) =>
  new Promise<{ code: number | null; out: string }>((resolve) => {
    const child = spawn('bash', [from, ...args], {
      env: {
        PATH: `${dir}/bin:${process.env.PATH ?? ''}`,
        TMPDIR: process.env.TMPDIR ?? '',
        FAKE_DIR: dir,
        FAKE_STUB: site.base,
        STATE_DIR: `${dir}/state`,
        ENV_DIR: `${dir}/env`,
        // Names come from infra/project.env; the environment wins over the file.
        PROJECT_NAME: 'atlas',
        DOMAIN: 'atlas.studio',
        SMOKE_URL: site.base,
        SMOKE_RESOLVE: '',
        SMOKE_HOME_WAIT: '0',
        ALERT_WEBHOOK_URL: `${site.base}/hook`,
        ASSETS_CMD: `${dir}/bin/assets`,
        ...env,
      },
    })
    let out = ''
    child.stdout.on('data', (d: Buffer) => (out += d))
    child.stderr.on('data', (d: Buffer) => (out += d))
    child.on('close', (code) => resolve({ code, out }))
  })

const calls = () => fs.readFileSync(`${dir}/calls`, 'utf8').trim().split('\n')
const live = () => fs.readFileSync(`${dir}/live`, 'utf8').trim()
const history = () => fs.readFileSync(`${dir}/state/releases`, 'utf8').trim().split('\n')
const ups = () => calls().filter((c) => / compose up /.test(c))

beforeAll(async () => {
  site = await startSiteStub()
})
afterAll(async () => {
  await site.close()
})
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-test-'))
  fs.mkdirSync(`${dir}/bin`)
  fs.mkdirSync(`${dir}/env`)
  fs.writeFileSync(`${dir}/bin/docker`, fakeDocker, { mode: 0o755 })
  // Stands in for infra/assets.sh: logs to the same call list.
  fs.writeFileSync(
    `${dir}/bin/assets`,
    `#!/usr/bin/env bash\necho "assets $*" >>"$FAKE_DIR/calls"\n[[ "$1" == upload && -n "\${FAKE_BAD_UPLOAD:-}" ]] && exit 1\nexit 0\n`,
    { mode: 0o755 },
  )
  fs.writeFileSync(`${dir}/calls`, '')
  fs.writeFileSync(`${dir}/live`, '')
  site.reset()
  site.live.broken.clear()
  site.hooks.length = 0
})

describe('infra/deploy.sh', () => {
  it('deploys a good tag in order: pull, DB copy, migrate, swap, and records it', async () => {
    expect((await run(['deploy', 'v1'])).code).toBe(0)
    const { code, out } = await run(['deploy', 'v2'])
    expect(code).toBe(0)
    expect(out).toContain('v2 is live')
    const steps = calls()
      .filter((c) => c.startsWith('RELEASE=v2 compose '))
      .map((c) => c.split(' ')[2])
    expect(steps).toEqual(['pull', 'run', 'run', 'up'])
    const copy = calls().find((c) => c.startsWith('RELEASE=v2') && c.includes('SNAPSHOT_NAME='))
    expect(copy).toMatch(/SNAPSHOT_NAME=\d{8}T\d{6}Z-v1-to-v2 /)
    expect(copy).toContain('KEEP_SNAPSHOTS=5')
    expect(ups().at(-1)).toMatch(/--wait .*--no-deps caddy web web-preview cms/)
    expect(ups().at(-1)).not.toMatch(/migrate/)
    expect(history()).toEqual(['v1', 'v2'])
    expect(site.hooks).toEqual([])
  })

  it('rolls back by itself and alerts when the new release fails the smoke checks', async () => {
    await run(['deploy', 'v1'])
    site.live.broken.add('v2')
    const { code, out } = await run(['deploy', 'v2'])
    expect(code).not.toBe(0)
    expect(ups().map((c) => c.split(' ')[0])).toEqual(['RELEASE=v1', 'RELEASE=v2', 'RELEASE=v1'])
    expect(live()).toBe('v1')
    expect(history()).toEqual(['v1'])
    expect(out).toContain('ALERT')
    expect(site.hooks).toHaveLength(1)
    const hook = site.hooks[0]!
    expect(hook.contentType).toBe('application/json')
    const body = JSON.parse(hook.body) as { text: string; content: string }
    expect(body.text).toMatch(/v2 failed .*Rolled back to v1/)
    expect(body.content).toBe(body.text)
  })

  it('rolls back when the new containers never get healthy', async () => {
    await run(['deploy', 'v1'])
    const { code } = await run(['deploy', 'v2'], { FAKE_UNHEALTHY: 'v2' })
    expect(code).not.toBe(0)
    expect(live()).toBe('v1')
    expect(site.hooks).toHaveLength(1)
  })

  it('says loudly when the rollback target fails too', async () => {
    await run(['deploy', 'v1'])
    site.live.broken.add('v1')
    site.live.broken.add('v2')
    const { code } = await run(['deploy', 'v2'])
    expect(code).not.toBe(0)
    expect(site.hooks[0]?.body).toMatch(/ALSO fails/)
  })

  it('a failing migration stops before any swap and leaves the old release running', async () => {
    await run(['deploy', 'v1'])
    const { code, out } = await run(['deploy', 'v2'], { FAKE_BAD_MIGRATE: 'v2' })
    expect(code).not.toBe(0)
    expect(ups()).toHaveLength(1) // only v1's
    expect(live()).toBe('v1')
    expect(history()).toEqual(['v1'])
    expect(out).toMatch(/migrations of v2 failed/)
    expect(site.hooks).toHaveLength(1)
  })

  it('a failing pre-migration copy stops before the migration', async () => {
    await run(['deploy', 'v1'])
    const { code } = await run(['deploy', 'v2'], { FAKE_BAD_SNAPSHOT: 'v2' })
    expect(code).not.toBe(0)
    expect(calls().filter((c) => c.startsWith('RELEASE=v2 compose run'))).toHaveLength(1)
    expect(ups()).toHaveLength(1)
  })

  it('the first deploy has nothing to roll back to and says so', async () => {
    site.live.broken.add('v1')
    const { code } = await run(['deploy', 'v1'])
    expect(code).not.toBe(0)
    expect(site.hooks[0]?.body).toMatch(/no previous release/)
  })

  it('takes the live tag from the running container when no history exists yet', async () => {
    fs.writeFileSync(`${dir}/live`, 'manual1\n')
    site.live.broken.add('v2')
    await run(['deploy', 'v2'])
    expect(live()).toBe('manual1')
  })

  it('manual rollback goes back one release, and again', async () => {
    for (const t of ['v1', 'v2', 'v3']) await run(['deploy', t])
    expect((await run(['rollback'])).code).toBe(0)
    expect(live()).toBe('v2')
    expect(history()).toEqual(['v1', 'v2'])
    expect(calls().filter((c) => c.startsWith('RELEASE=v2 compose run'))).toHaveLength(2) // no new migrate
    expect((await run(['rollback'])).code).toBe(0)
    expect(live()).toBe('v1')
    expect((await run(['rollback'])).code).not.toBe(0)
  })

  it('a manual rollback whose target fails goes back to the current release and alerts', async () => {
    for (const t of ['v1', 'v2']) await run(['deploy', t])
    site.live.broken.add('v1')
    const { code } = await run(['rollback'])
    expect(code).not.toBe(0)
    expect(live()).toBe('v2')
    expect(history()).toEqual(['v1', 'v2'])
    expect(site.hooks).toHaveLength(1)
  })

  it('refuses to run while another deploy holds the lock, and takes over a stale lock', async () => {
    fs.mkdirSync(`${dir}/state/deploy.lock`, { recursive: true })
    fs.writeFileSync(`${dir}/state/deploy.lock/pid`, String(process.pid))
    const busy = await run(['deploy', 'v1'])
    expect(busy.code).not.toBe(0)
    expect(busy.out).toMatch(/another deploy is running/)
    expect(ups()).toHaveLength(0)

    fs.writeFileSync(`${dir}/state/deploy.lock/pid`, '999999')
    expect((await run(['deploy', 'v1'])).code).toBe(0)
    expect(fs.existsSync(`${dir}/state/deploy.lock`)).toBe(false)
  })

  it('rejects a bad tag and an unknown command', async () => {
    expect((await run(['deploy', '../x'])).code).not.toBe(0)
    expect((await run(['deploy', 'a'.repeat(101)])).code).not.toBe(0)
    expect((await run(['deploy'])).code).not.toBe(0)
    expect((await run(['nope'])).code).not.toBe(0)
    expect(calls()).toEqual([''])
  })

  it('without a webhook URL the alert is only logged, loudly', async () => {
    await run(['deploy', 'v1'])
    const { code, out } = await run(['deploy', 'v2'], {
      ALERT_WEBHOOK_URL: '',
      FAKE_BAD_MIGRATE: 'v2',
    })
    expect(code).not.toBe(0)
    expect(out).toMatch(/ALERT_WEBHOOK_URL is not set/)
    expect(site.hooks).toEqual([])
  })

  it('reads deploy.env and can send a plain-text alert (ntfy)', async () => {
    await run(['deploy', 'v1'])
    fs.writeFileSync(
      `${dir}/env/deploy.env`,
      `ALERT_WEBHOOK_URL=${site.base}/hook\nALERT_WEBHOOK_FORMAT=text\n`,
    )
    await run(['deploy', 'v2'], { ALERT_WEBHOOK_URL: '', FAKE_BAD_MIGRATE: 'v2' })
    expect(site.hooks).toHaveLength(1)
    expect(site.hooks[0]?.contentType).toMatch(/^text\/plain/)
    expect(site.hooks[0]?.body).toMatch(/^atlas deploy on .*migrations of v2 failed/)
  })

  it('skips the pull with DEPLOY_PULL=0', async () => {
    await run(['deploy', 'v1'], { DEPLOY_PULL: '0' })
    expect(calls().some((c) => c.includes(' pull '))).toBe(false)
  })

  describe('Litestream hook', () => {
    it('syncs the off-site replica before migrating when Litestream runs', async () => {
      await run(['deploy', 'v1'])
      const { code, out } = await run(['deploy', 'v2'], { FAKE_LITESTREAM: '1' })
      expect(code).toBe(0)
      const v2 = calls().filter((c) => c.startsWith('RELEASE=v2') || c.includes('litestream sync'))
      const sync = v2.findIndex((c) => c.includes('exec -T litestream litestream sync'))
      const migrate = v2.findIndex((c) => / compose run --rm --no-deps -T migrate$/.test(c))
      expect(sync).toBeGreaterThan(-1)
      expect(sync).toBeLessThan(migrate)
      expect(out).toMatch(/restore point .*-timestamp \d{4}-\d\d-\d\dT/)
    })

    it('a failed sync stops before the migration, nothing swapped', async () => {
      await run(['deploy', 'v1'])
      const { code, out } = await run(['deploy', 'v2'], {
        FAKE_LITESTREAM: '1',
        FAKE_BAD_SYNC: '1',
      })
      expect(code).not.toBe(0)
      expect(calls().some((c) => /RELEASE=v2 .*-T migrate$/.test(c))).toBe(false)
      expect(ups()).toHaveLength(1)
      expect(out).toMatch(/Litestream sync failed/)
      expect(site.hooks).toHaveLength(1)
    })

    it('without a running Litestream (first deploy) it carries on with a notice', async () => {
      const { code, out } = await run(['deploy', 'v1'])
      expect(code).toBe(0)
      expect(out).toMatch(/NOTICE.*litestream is not running/i)
    })
  })

  describe('static assets hook, DEPLOY_ASSETS=1', () => {
    it('uploads before migrate and swap, prunes after a healthy deploy', async () => {
      await run(['deploy', 'v1'])
      fs.writeFileSync(`${dir}/calls`, '')
      expect(
        (await run(['deploy', 'v2'], { DEPLOY_ASSETS: '1', IMAGE_PREFIX: 'ghcr.io/x' })).code,
      ).toBe(0)
      const c = calls()
      const upload = c.indexOf('assets upload ghcr.io/x/web:v2 v2')
      expect(upload).toBeGreaterThan(-1)
      expect(upload).toBeLessThan(c.findIndex((l) => / -T migrate$/.test(l)))
      expect(c.at(-1)).toBe('assets prune --keep v1,v2')
    })

    it('a failed upload stops before anything is swapped', async () => {
      await run(['deploy', 'v1'])
      const { code } = await run(['deploy', 'v2'], { DEPLOY_ASSETS: '1', FAKE_BAD_UPLOAD: '1' })
      expect(code).not.toBe(0)
      expect(ups()).toHaveLength(1)
      expect(site.hooks).toHaveLength(1)
    })

    it('keeps the previous LIVE release, not a newer one that failed and rolled back', async () => {
      await run(['deploy', 'A'], { DEPLOY_ASSETS: '1' })
      site.live.broken.add('B')
      await run(['deploy', 'B'], { DEPLOY_ASSETS: '1' })
      await run(['deploy', 'C'], { DEPLOY_ASSETS: '1' })
      expect(calls().filter((c) => c.startsWith('assets prune'))).toEqual([
        'assets prune --keep A',
        'assets prune --keep A,C',
      ])
      expect((await run(['live-releases'])).out.trim().split('\n')).toEqual(['A', 'C'])
    })

    it('does not prune after a rollback, and is off by default', async () => {
      await run(['deploy', 'v1'])
      site.live.broken.add('v2')
      await run(['deploy', 'v2'], { DEPLOY_ASSETS: '1' })
      expect(calls().some((c) => c.startsWith('assets prune'))).toBe(false)
      site.live.broken.clear()
      await run(['deploy', 'v3'])
      expect(calls().filter((c) => c.startsWith('assets '))).toEqual([
        'assets upload atlas/web:v2 v2',
      ])
    })
  })

  describe('versioned config (each release keeps its own infra/ folder)', () => {
    const infra = () => `${dir}/infra`
    const releaseScript = (tag: string) => `${infra()}/releases/${tag}/deploy.sh`
    const liveFile = (rel: string) => fs.readFileSync(`${infra()}/live/${rel}`, 'utf8')
    const at = (tag: string, args: string[], env: Record<string, string> = {}) =>
      run(args, env, releaseScript(tag))

    // What CI ships: this repo's scripts plus a compose file and Caddy config marked per release.
    const ship = (tag: string, caddy: string, litestream = 'dbs: []\n') => {
      const root = `${infra()}/releases/${tag}`
      fs.mkdirSync(`${root}/caddy`, { recursive: true })
      fs.mkdirSync(`${root}/litestream`, { recursive: true })
      for (const f of ['deploy.sh', 'smoke.sh', 'project.sh', 'project.env']) {
        fs.copyFileSync(path.resolve(import.meta.dirname, f), `${root}/${f}`)
        fs.chmodSync(`${root}/${f}`, 0o755)
      }
      fs.writeFileSync(`${root}/compose.yaml`, `# compose of ${tag}\n`)
      fs.writeFileSync(`${root}/caddy/Caddyfile`, caddy)
      fs.writeFileSync(`${root}/caddy/site.caddy`, 'site\n')
      fs.writeFileSync(`${root}/litestream/litestream.yml`, litestream)
    }
    const reloads = () => calls().filter((c) => c.includes('exec -T caddy caddy reload'))

    it('runs the services from live/ with the deployed release config', async () => {
      ship('v1', 'caddy one\n')
      expect((await at('v1', ['deploy', 'v1'])).code).toBe(0)
      expect(fs.realpathSync(fs.readFileSync(`${dir}/up-cwd`, 'utf8').trim())).toBe(
        fs.realpathSync(`${infra()}/live`),
      )
      expect(liveFile('compose.yaml')).toBe('# compose of v1\n')
      expect(fs.readFileSync(`${dir}/caddy-at-up`, 'utf8')).toBe('caddy one\n')

      ship('v2', 'caddy two\n')
      expect((await at('v2', ['deploy', 'v2'])).code).toBe(0)
      expect(liveFile('compose.yaml')).toBe('# compose of v2\n')
      expect(liveFile('caddy/Caddyfile')).toBe('caddy two\n')
      expect(reloads().length).toBeGreaterThan(0)
    })

    it('an automatic rollback brings back the previous release config, and reloads Caddy', async () => {
      ship('v1', 'caddy one\n', 'one\n')
      await at('v1', ['deploy', 'v1'])
      ship('v2', 'caddy two\n', 'two\n')
      site.live.broken.add('v2')
      fs.writeFileSync(`${dir}/calls`, '')
      const { code } = await at('v2', ['deploy', 'v2'])
      expect(code).not.toBe(0)
      expect(live()).toBe('v1')
      expect(liveFile('compose.yaml')).toBe('# compose of v1\n')
      expect(liveFile('caddy/Caddyfile')).toBe('caddy one\n')
      expect(liveFile('litestream/litestream.yml')).toBe('one\n')
      // Reloaded on the way to v2 and again on the way back.
      expect(reloads()).toHaveLength(2)
      expect(fs.readFileSync(`${dir}/caddy-at-up`, 'utf8')).toBe('caddy one\n')
    })

    it('does not reload Caddy when its config did not change', async () => {
      ship('v1', 'same\n')
      await at('v1', ['deploy', 'v1'])
      ship('v2', 'same\n')
      fs.writeFileSync(`${dir}/calls`, '')
      expect((await at('v2', ['deploy', 'v2'])).code).toBe(0)
      expect(reloads()).toEqual([])
    })

    it('recreates Caddy when the reload fails', async () => {
      ship('v1', 'one\n')
      await at('v1', ['deploy', 'v1'])
      ship('v2', 'two\n')
      fs.writeFileSync(`${dir}/calls`, '')
      expect((await at('v2', ['deploy', 'v2'], { FAKE_BAD_RELOAD: '1' })).code).toBe(0)
      expect(ups().at(-1)).toMatch(/--force-recreate caddy$/)
    })

    it('a manual rollback from live/ restores the previous config too', async () => {
      ship('v1', 'one\n')
      await at('v1', ['deploy', 'v1'])
      ship('v2', 'two\n')
      await at('v2', ['deploy', 'v2'])
      const { code } = await run(['rollback'], {}, `${infra()}/live/deploy.sh`)
      expect(code).toBe(0)
      expect(live()).toBe('v1')
      expect(liveFile('compose.yaml')).toBe('# compose of v1\n')
      expect(liveFile('caddy/Caddyfile')).toBe('one\n')
    })

    it('a release config that cannot be copied fails the swap and rolls back, never starting it', async () => {
      ship('v1', 'one\n')
      await at('v1', ['deploy', 'v1'])
      ship('v2', 'two\n')
      // cp cannot read this file, so the config of v2 cannot be put in place.
      fs.writeFileSync(`${infra()}/releases/v2/caddy/unreadable.caddy`, 'x\n', { mode: 0o000 })
      fs.writeFileSync(`${dir}/calls`, '')
      const { code, out } = await at('v2', ['deploy', 'v2'])
      fs.chmodSync(`${infra()}/releases/v2/caddy/unreadable.caddy`, 0o644)
      expect(code).not.toBe(0)
      expect(out).toContain('failed its checks')
      expect(ups().some((c) => c.startsWith('RELEASE=v2 '))).toBe(false)
      expect(live()).toBe('v1')
      expect(history()).toEqual(['v1'])
      expect(liveFile('caddy/Caddyfile')).toBe('one\n')
    })

    it('removes files a release no longer has, and config folders of releases not in the history', async () => {
      ship('v1', 'one\n')
      fs.writeFileSync(`${infra()}/releases/v1/caddy/old.caddy`, 'old\n')
      await at('v1', ['deploy', 'v1'])
      expect(fs.existsSync(`${infra()}/live/caddy/old.caddy`)).toBe(true)
      ship('bad', 'bad\n')
      site.live.broken.add('bad')
      await at('bad', ['deploy', 'bad'])
      ship('v2', 'two\n')
      expect((await at('v2', ['deploy', 'v2'])).code).toBe(0)
      expect(fs.existsSync(`${infra()}/live/caddy/old.caddy`)).toBe(false)
      expect(fs.readdirSync(`${infra()}/releases`).sort()).toEqual(['v1', 'v2'])
    })
  })
})
