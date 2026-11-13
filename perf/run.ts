// `pnpm perf`: measures a production build of the site and writes perf/.output/report.json. Local
// only: CI runners have no GPU. See the README section "Perf".
//
//   PERF_BASE_URL=http://localhost:3000 pnpm perf   measure a site that is already running
//   pnpm perf                                       build and serve the production image through
//                                                   the smoke runner (smoke/run.ts), then measure it
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const run = (script: string, env: NodeJS.ProcessEnv) => {
  const child = spawn('node', [script, ...process.argv.slice(2)], {
    cwd: root,
    stdio: 'inherit',
    env,
  })
  child.on('exit', (status) => process.exit(status ?? 1))
}

if (process.env.PERF_BASE_URL) {
  run('perf/measure.ts', process.env)
} else if (fs.existsSync(path.join(root, 'smoke/run.ts'))) {
  run('smoke/run.ts', {
    ...process.env,
    SMOKE_PORT: process.env.SMOKE_PORT ?? '3100',
    SMOKE_RUNNER: 'perf/measure.ts',
    // Measure what visitors get without a CDN hop: assets from the container itself.
    SMOKE_ASSET_PREFIX: process.env.SMOKE_ASSET_PREFIX ?? '',
  })
} else {
  console.error('[perf] no smoke runner here: set PERF_BASE_URL to a running production site')
  process.exit(1)
}
