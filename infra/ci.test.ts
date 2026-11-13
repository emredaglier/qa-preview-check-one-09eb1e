import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const script = path.resolve(import.meta.dirname, 'ci.sh')

function ci(args: string[], env: Record<string, string> = {}) {
  // A clean environment: nothing from the developer's shell may satisfy a secret gate.
  const r = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      TMPDIR: process.env.TMPDIR ?? '',
      HOME: process.env.HOME ?? '',
      // Names come from infra/project.env; the environment wins over the file.
      PROJECT_NAME: 'atlas',
      DOMAIN: 'atlas.studio',
      ...env,
    },
  })
  return { status: r.status, out: r.stdout + r.stderr }
}

const SHA = 'a'.repeat(40)
const TAG = 'v1.2.3'
const upload = { R2_ACCOUNT_ID: 'a', R2_MEDIA_WRITE_KEY_ID: 'k', R2_MEDIA_WRITE_SECRET: 's' }
const deploy = {
  ...upload,
  DEPLOY_HOST: 'h',
  DEPLOY_USER: 'u',
  DEPLOY_SSH_KEY: 'key',
  DEPLOY_HOST_KEY: 'hostkey',
  TS_OAUTH_CLIENT_ID: 'i',
  TS_OAUTH_SECRET: 's',
}

describe('secret gates (the steps that skip until the owner sets the secrets)', () => {
  it('upload skips cleanly, exit 0, while any secret is missing', () => {
    const none = ci(['gate', 'upload'])
    expect(none.status).toBe(0)
    expect(none.out).toContain('ready=false')
    expect(none.out).toContain('R2_ACCOUNT_ID')
    const partial = ci(['gate', 'upload'], { ...upload, R2_MEDIA_WRITE_SECRET: '' })
    expect(partial.out).toContain('ready=false')
    expect(partial.out).toContain('R2_MEDIA_WRITE_SECRET')
  })

  it('upload is ready when all secrets are set', () => {
    expect(ci(['gate', 'upload'], upload).out).toContain('ready=true')
  })

  it('deploy needs the tailnet, SSH and upload secrets together', () => {
    expect(ci(['gate', 'deploy']).out).toContain('ready=false')
    expect(ci(['gate', 'deploy'], upload).out).toContain('ready=false')
    for (const key of Object.keys(deploy)) {
      const missing = ci(['gate', 'deploy'], { ...deploy, [key]: '' })
      expect(missing.status, key).toBe(0)
      expect(missing.out, key).toContain('ready=false')
    }
    expect(ci(['gate', 'deploy'], deploy).out).toContain('ready=true')
  })

  it('writes the result for GitHub Actions', () => {
    const out = path.join(fs.mkdtempSync(path.join(import.meta.dirname, '.gate-')), 'output')
    try {
      ci(['gate', 'upload'], { GITHUB_OUTPUT: out })
      expect(fs.readFileSync(out, 'utf8')).toBe('ready=false\n')
    } finally {
      fs.rmSync(path.dirname(out), { recursive: true, force: true })
    }
  })

  it('rejects an unknown group and an id that is neither a git sha nor a release tag', () => {
    expect(ci(['gate', 'nope']).status).toBe(1)
    expect(ci(['build', 'latest']).status).toBe(1)
    expect(ci(['smoke', 'main']).status).toBe(1)
    expect(ci(['push', 'main']).status).toBe(1)
    expect(ci(['deploy', '../x']).status).toBe(1)
  })

  it('publish, upload, push and deploy take a release tag only, never a commit', () => {
    for (const cmd of ['publish', 'upload', 'push', 'deploy']) {
      const r = ci([cmd, SHA])
      expect(r.status, cmd).toBe(1)
      expect(r.out, cmd).toContain('release tag')
    }
    // A release tag is also a valid release name (infra/project.sh): not longer than 100.
    for (const bad of [
      '1.2.3',
      'v1',
      'v1.2',
      'v1.2.3+build',
      'v1.2.3/../x',
      'vlatest',
      `v1.2.3-${'x'.repeat(100)}`,
    ]) {
      expect(ci(['deploy', bad]).status, bad).toBe(1)
    }
  })

  it('upload, push and deploy refuse to run without their secrets', () => {
    for (const cmd of ['upload', 'push', 'deploy']) {
      const r = ci([cmd, TAG])
      expect(r.status, cmd).not.toBe(0)
    }
  })

  it('every release command refuses while infra/project.env is still the template placeholder', () => {
    for (const cmd of ['publish', 'upload', 'push', 'deploy', 'verify-release']) {
      const r = ci([cmd, TAG], { DOMAIN: 'example.com', ...deploy })
      expect(r.status, cmd).toBe(1)
      expect(r.out, cmd).toContain('project.env')
    }
  })
})

// `verify-release` needs a git checkout, so it runs against a throwaway copy of the scripts.
describe('verify-release: a release is cut from main only', () => {
  const git = (cwd: string, ...args: string[]) =>
    spawnSync(
      'git',
      [
        '-c',
        'user.email=t@example.test',
        '-c',
        'user.name=t',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd, encoding: 'utf8' },
    )
  function checkout() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-release-'))
    fs.mkdirSync(`${dir}/infra`)
    for (const f of ['ci.sh', 'project.sh', 'project.env']) {
      fs.copyFileSync(path.resolve(import.meta.dirname, f), `${dir}/infra/${f}`)
    }
    git(dir, 'init', '-q', '-b', 'main')
    git(dir, 'add', '.')
    git(dir, 'commit', '-q', '-m', 'one')
    return dir
  }
  const verify = (dir: string) =>
    spawnSync('bash', [`${dir}/infra/ci.sh`, 'verify-release', TAG], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        TMPDIR: process.env.TMPDIR ?? '',
        HOME: process.env.HOME ?? '',
        PROJECT_NAME: 'atlas',
        DOMAIN: 'atlas.studio',
      },
    })

  it('passes for a commit that is in origin/main', () => {
    const dir = checkout()
    try {
      git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
      const r = verify(dir)
      expect(r.status, r.stderr).toBe(0)
      expect(r.stdout).toContain(`${TAG} is on main`)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails for a commit that only exists on another branch', () => {
    const dir = checkout()
    try {
      git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
      git(dir, 'checkout', '-q', '-b', 'feature')
      fs.writeFileSync(`${dir}/x`, 'x')
      git(dir, 'add', '.')
      git(dir, 'commit', '-q', '-m', 'two')
      const r = verify(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('not on main')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails when origin/main is not there, instead of passing', () => {
    const dir = checkout()
    try {
      const r = verify(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('origin/main')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

// A fake `docker` on the PATH: logs every call and answers `push` the way the real one ends its
// output, with a digest per image. No daemon, no registry.
const DIGEST = { web: 'a'.repeat(64), cms: 'b'.repeat(64), migrate: 'c'.repeat(64) }
function fakeDocker() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-docker-'))
  const log = path.join(dir, 'calls')
  fs.writeFileSync(
    path.join(dir, 'docker'),
    `#!/usr/bin/env bash
echo "$*" >>"${log}"
if [ "$1" = push ]; then
  case "$2" in
    */web:*) d=${DIGEST.web} ;; */cms:*) d=${DIGEST.cms} ;; */migrate:*) d=${DIGEST.migrate} ;;
  esac
  echo "The push refers to repository [\${2%:*}]"
  echo "\${2##*:}: digest: sha256:$d size: 1234"
fi
`,
    { mode: 0o755 },
  )
  return {
    env: { PATH: `${dir}:${process.env.PATH ?? ''}`, TMPDIR: process.env.TMPDIR ?? '' },
    calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []),
    done: () => fs.rmSync(dir, { recursive: true, force: true }),
  }
}

describe('images go between jobs by digest, through the registry', () => {
  const P = 'ghcr.io/o/atlas'
  const registry = { IMAGE_PREFIX: P, GHCR_TOKEN: 't', GITHUB_ACTOR: 'a' }
  const ref = (t: keyof typeof DIGEST) => `${P}/${t}@sha256:${DIGEST[t]}`

  it('publish pushes the release tag only and hands each pushed digest to the later jobs', () => {
    const docker = fakeDocker()
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ci-out-')), 'output')
    try {
      const r = ci(['publish', TAG], { ...registry, ...docker.env, GITHUB_OUTPUT: out })
      expect(r.status, r.out).toBe(0)
      expect(docker.calls().filter((c) => c.startsWith('push '))).toEqual([
        `push ${P}/web:${TAG}`,
        `push ${P}/cms:${TAG}`,
        `push ${P}/migrate:${TAG}`,
      ])
      expect(fs.readFileSync(out, 'utf8')).toBe(
        `web=${ref('web')}\ncms=${ref('cms')}\nmigrate=${ref('migrate')}\n`,
      )
      expect(r.out).toContain(ref('web'))
    } finally {
      docker.done()
      fs.rmSync(path.dirname(out), { recursive: true, force: true })
    }
  })

  const images = { WEB_IMAGE: ref('web'), CMS_IMAGE: ref('cms'), MIGRATE_IMAGE: ref('migrate') }

  it('push moves the latest tags to the published digests, in the registry, without pulling', () => {
    const docker = fakeDocker()
    try {
      const r = ci(['push', TAG], { ...registry, ...images, ...docker.env })
      expect(r.status, r.out).toBe(0)
      const calls = docker.calls().filter((c) => !c.startsWith('login '))
      expect(calls).toEqual([
        `buildx imagetools create --prefer-index=false -t ${P}/web:latest ${ref('web')}`,
        `buildx imagetools create --prefer-index=false -t ${P}/cms:latest ${ref('cms')}`,
        `buildx imagetools create --prefer-index=false -t ${P}/migrate:latest ${ref('migrate')}`,
      ])
    } finally {
      docker.done()
    }
  })

  it('push refuses a missing digest, a tag instead of a digest, or another image', () => {
    const docker = fakeDocker()
    try {
      const bad = [
        { ...images, CMS_IMAGE: '' },
        { ...images, WEB_IMAGE: `${P}/web:${TAG}` },
        { ...images, MIGRATE_IMAGE: ref('web') },
      ]
      for (const env of bad) {
        const r = ci(['push', TAG], { ...registry, ...env, ...docker.env })
        expect(r.status, JSON.stringify(env)).not.toBe(0)
      }
      expect(docker.calls().some((c) => c.includes('imagetools'))).toBe(false)
    } finally {
      docker.done()
    }
  })

  it('upload refuses a web image that is not a published digest, before touching anything', () => {
    const docker = fakeDocker()
    try {
      for (const WEB_IMAGE of ['', `${P}/web:${TAG}`, ref('cms')]) {
        const r = ci(['upload', TAG], { ...registry, ...upload, WEB_IMAGE, ...docker.env })
        expect(r.status, WEB_IMAGE).not.toBe(0)
        expect(r.out, WEB_IMAGE).toContain('WEB_IMAGE')
      }
      expect(docker.calls()).toEqual([])
    } finally {
      docker.done()
    }
  })

  it('publish refuses without registry credentials', () => {
    const docker = fakeDocker()
    try {
      expect(ci(['publish', TAG], { IMAGE_PREFIX: P, ...docker.env }).status).not.toBe(0)
      expect(docker.calls().some((c) => c.startsWith('push '))).toBe(false)
    } finally {
      docker.done()
    }
  })
})

// A fake `ssh` that records what it is asked to run and answers `live-releases` the way the server
// does; `ASSETS_CMD` is a fake assets script. No server, no registry, no bucket.
describe('release steps run the other scripts as the deploy expects', () => {
  const P = 'ghcr.io/o/atlas'
  const registry = { IMAGE_PREFIX: P, GHCR_TOKEN: 't', GITHUB_ACTOR: 'a' }

  function sandbox(options: { liveReleases?: string; failingDeploy?: boolean } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-steps-'))
    const log = path.join(dir, 'calls')
    const bin = (name: string, body: string) =>
      fs.writeFileSync(path.join(dir, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 })
    bin(
      'ssh',
      `echo "ssh $*" >>"${log}"
cat >/dev/null <&0 || true
case "$*" in
  *"live-releases"*) printf '%b' "${options.liveReleases ?? 'v1.2.2\\nv1.2.3\\n'}" ;;
  *"deploy.sh deploy"*) ${options.failingDeploy ? 'exit 1' : 'true'} ;;
esac`,
    )
    bin(
      'docker',
      `echo "docker $*" >>"${log}"
if [ "$1" = image ] && [ "$2" = ls ] && [ "$3" = --format ] && [ "$4" = '{{.Size}}' ]; then echo "120MB"; fi`,
    )
    bin(
      'assets',
      `echo "assets $*" >>"${log}"
case "$1" in
  build-args) echo "--build-arg ASSET_PREFIX=prefix-of-$2 --build-arg DEPLOYMENT_ID=$2" ;;
  asset-prefix) echo "prefix-of-$2" ;;
esac`,
    )
    return {
      env: {
        PATH: `${dir}:${process.env.PATH ?? ''}`,
        TMPDIR: process.env.TMPDIR ?? '',
        ASSETS_CMD: path.join(dir, 'assets'),
        CI_PLATFORM: 'linux/arm64',
      },
      calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []),
      done: () => fs.rmSync(dir, { recursive: true, force: true }),
    }
  }
  const server = {
    DEPLOY_HOST: 'h',
    DEPLOY_USER: 'u',
    DEPLOY_SSH_KEY: 'key',
    DEPLOY_HOST_KEY: 'hostkey',
    APP_DIR: '/srv/atlas',
  }

  it('build makes the three images with the release tag and the assets script build args', () => {
    const box = sandbox()
    try {
      const r = ci(['build', TAG], { ...registry, ...box.env })
      expect(r.status, r.out).toBe(0)
      const builds = box.calls().filter((c) => c.startsWith('docker buildx build '))
      expect(builds).toHaveLength(3)
      for (const target of ['web', 'cms', 'migrate']) {
        const call = builds.find((c) => c.includes(`--target ${target} `))
        expect(call, target).toContain(`-t ${P}/${target}:${TAG}`)
        expect(call, target).toContain(`--build-arg DEPLOYMENT_ID=${TAG}`)
        expect(call, target).toContain(`--build-arg ASSET_PREFIX=prefix-of-${TAG}`)
      }
    } finally {
      box.done()
    }
  })

  it('build makes only the images CI_TARGETS names, for the pull request gate', () => {
    const box = sandbox()
    try {
      const r = ci(['build', SHA], { ...registry, ...box.env, CI_TARGETS: 'web' })
      expect(r.status, r.out).toBe(0)
      const builds = box.calls().filter((c) => c.startsWith('docker buildx build '))
      expect(builds).toHaveLength(1)
      expect(builds[0]).toContain(`--target web `)
      expect(builds[0]).toContain(`-t ${P}/web:${SHA}`)
      expect(builds[0]).toContain(`--build-arg DEPLOYMENT_ID=${SHA}`)
    } finally {
      box.done()
    }
  })

  it('only build reads CI_TARGETS: a bad value does not stop any other command', () => {
    expect(ci(['gate', 'upload'], { CI_TARGETS: 'docs' }).status).toBe(0)
    const box = sandbox()
    fakePnpm(box)
    try {
      expect(ci(['smoke', SHA], { ...registry, ...box.env, CI_TARGETS: 'docs' }).status).toBe(0)
    } finally {
      box.done()
    }
  })

  it('build refuses a target that is not an image of this repo, before it builds anything', () => {
    const box = sandbox()
    try {
      const r = ci(['build', SHA], { ...registry, ...box.env, CI_TARGETS: 'web docs' })
      expect(r.status).toBe(1)
      expect(r.out).toContain('docs')
      expect(box.calls().some((c) => c.startsWith('docker buildx build '))).toBe(false)
    } finally {
      box.done()
    }
  })

  it('check runs lint, the asset-weight budget, typecheck and the unit tests, in that order', () => {
    const box = sandbox()
    const dir = path.dirname(box.env.ASSETS_CMD)
    for (const name of ['pnpm', 'actionlint'])
      fs.writeFileSync(
        path.join(dir, name),
        `#!/usr/bin/env bash\necho "${name} $*" >>"$(dirname "$0")/calls"\n`,
        { mode: 0o755 },
      )
    try {
      const r = ci(['check'], { ...box.env })
      expect(r.status, r.out).toBe(0)
      expect(box.calls()).toEqual([
        expect.stringMatching(/^actionlint /),
        'pnpm lint',
        'pnpm check:assets',
        'pnpm typecheck',
        'pnpm test',
      ])
    } finally {
      box.done()
    }
  })

  /** A fake `pnpm` that logs each argument in brackets, and the variables smoke hands over. */
  const fakePnpm = (box: ReturnType<typeof sandbox>) =>
    fs.writeFileSync(
      path.join(path.dirname(box.env.ASSETS_CMD), 'pnpm'),
      '#!/usr/bin/env bash\n' +
        '{ printf "pnpm"; printf " [%s]" "$@"; echo " image=$SMOKE_WEB_IMAGE prefix=$SMOKE_ASSET_PREFIX"; } >>"$(dirname "$0")/calls"\n',
      { mode: 0o755 },
    )

  it('smoke asks the assets script for the prefix the built image was given', () => {
    // `pnpm smoke` itself is not run here: only what ci.sh hands to it is.
    const box = sandbox()
    fakePnpm(box)
    try {
      const r = ci(['smoke', SHA], { ...registry, ...box.env })
      expect(r.status, r.out).toBe(0)
      expect(box.calls()).toContain(`pnpm [smoke] image=${P}/web:${SHA} prefix=prefix-of-${SHA}`)
    } finally {
      box.done()
    }
  })

  it('smoke runs the self-tests of the checks for a commit, and leaves them out for a release tag', () => {
    // A tag runs the same checks on the page (accessibility, WebGL, secrets); the tests of the
    // check code itself ran on the pull request and on main (ADR-0012).
    const box = sandbox()
    fakePnpm(box)
    try {
      const tag = ci(['smoke', TAG], { ...registry, ...box.env })
      expect(tag.status, tag.out).toBe(0)
      expect(box.calls().filter((c) => c.startsWith('pnpm '))).toEqual([
        `pnpm [smoke] [--grep-invert] [check self-test] image=${P}/web:${TAG} prefix=prefix-of-${TAG}`,
      ])
    } finally {
      box.done()
    }
  })

  it('smoke passes extra arguments on, after the self-test filter on a tag', () => {
    const box = sandbox()
    fakePnpm(box)
    try {
      ci(['smoke', TAG, '-g', 'no server secret'], { ...registry, ...box.env })
      ci(['smoke', SHA, '-g', 'no server secret'], { ...registry, ...box.env })
      expect(box.calls().filter((c) => c.startsWith('pnpm '))).toEqual([
        expect.stringContaining(
          'pnpm [smoke] [--grep-invert] [check self-test] [-g] [no server secret] ',
        ),
        expect.stringContaining('pnpm [smoke] [-g] [no server secret] '),
      ])
    } finally {
      box.done()
    }
  })

  const published = { WEB_IMAGE: `${P}/web@sha256:${'a'.repeat(64)}` }

  it('upload hands the published web digest and the release to the assets script', () => {
    const box = sandbox()
    try {
      const r = ci(['upload', TAG], { ...registry, ...upload, ...published, ...box.env })
      expect(r.status, r.out).toBe(0)
      expect(box.calls()).toContain(`assets upload ${published.WEB_IMAGE} ${TAG}`)
    } finally {
      box.done()
    }
  })

  it('deploy copies infra/ to releases/<tag>, runs that deploy.sh, then prunes except the live releases', () => {
    const box = sandbox()
    try {
      const r = ci(['deploy', TAG], { ...registry, ...deploy, ...server, ...box.env })
      expect(r.status, r.out).toBe(0)
      const calls = box.calls()
      const dir = '/srv/atlas/infra/releases/' + TAG
      const at = (needle: string) => calls.findIndex((c) => c.includes(needle))
      expect(at(`mkdir -p '${dir}' && tar -xf - -C '${dir}'`)).toBeGreaterThan(-1)
      const run = at(`cd '${dir}' && IMAGE_PREFIX='${P}' ./deploy.sh deploy '${TAG}'`)
      expect(run).toBeGreaterThan(at('tar -xf -'))
      expect(at('./deploy.sh live-releases')).toBeGreaterThan(run)
      expect(calls.at(-1)).toBe(`assets prune --keep v1.2.2,${TAG}`)
    } finally {
      box.done()
    }
  })

  it('deploy that fails on the server (after its own rollback) fails the build and prunes nothing', () => {
    const box = sandbox({ failingDeploy: true })
    try {
      const r = ci(['deploy', TAG], { ...registry, ...deploy, ...server, ...box.env })
      expect(r.status).not.toBe(0)
      expect(box.calls().some((c) => c.startsWith('assets prune'))).toBe(false)
    } finally {
      box.done()
    }
  })

  it('deploy prunes nothing when the server does not report the release as live', () => {
    const box = sandbox({ liveReleases: 'v1.2.1\\nv1.2.2\\n' })
    try {
      const r = ci(['deploy', TAG], { ...registry, ...deploy, ...server, ...box.env })
      expect(r.status).not.toBe(0)
      expect(box.calls().some((c) => c.startsWith('assets prune'))).toBe(false)
    } finally {
      box.done()
    }
  })
})
