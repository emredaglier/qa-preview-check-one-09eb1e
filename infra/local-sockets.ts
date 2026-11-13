import { spawnSync } from 'node:child_process'

// The suites that start a local HTTP server (the S3, Cloudflare and site stubs). An agent's
// sandbox may refuse local sockets; `vitest.config.ts` then skips these, like `hasDocker` in
// `assets.test.ts` skips its Docker test. CI and laptops run them.
export const SOCKET_SUITES = [
  'infra/assets.test.ts',
  'infra/release-assets.test.ts',
  'infra/cloudflare.test.ts',
  'infra/deploy.test.ts',
  'infra/smoke.test.ts',
]

// Listens on the host and connects back, in a child process: a refused `listen` is an error event
// there, not a hang in a test hook. The timeout covers a sandbox that stalls instead of refusing.
const PROBE = `const net = require('net')
const host = process.argv[1]
const server = net.createServer((c) => c.end())
server.on('error', () => process.exit(1))
server.listen(0, host, () => {
  const c = net.connect(server.address().port, host)
  c.on('error', () => process.exit(1))
  c.on('connect', () => { c.destroy(); server.close() })
})`

export function canListenLocally(host = '127.0.0.1'): boolean {
  return spawnSync(process.execPath, ['-e', PROBE, host], { timeout: 5000 }).status === 0
}

// On CI a refused probe is an error: a skip there would hide the five suites from the gate.
export function socketSuitesToSkip(canListen: boolean, ci: boolean): string[] {
  if (canListen) return []
  if (ci) {
    throw new Error(
      `CI=true but local sockets are refused, so ${SOCKET_SUITES.join(', ')} cannot run. CI never skips them.`,
    )
  }
  return SOCKET_SUITES
}
