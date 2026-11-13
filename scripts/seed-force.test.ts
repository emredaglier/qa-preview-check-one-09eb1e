import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

// `payload run` swallows flags that come before a `--`, so `--force` reaches the
// seed script only after one. The seed tests call runSeed directly and miss this.
// Here the real `payload run` starts a stub that prints its argv: no database.
const root = path.resolve(import.meta.dirname, '..')
const cmsDir = path.join(root, 'apps/cms')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-force-'))
const stub = path.join(tmp, 'stub.ts')
fs.writeFileSync(stub, 'console.log("ARGS:" + JSON.stringify(process.argv.slice(2)))\n')

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

// The package script is `payload run scripts/seed.ts --`; `pnpm seed --force` appends the flag.
const seedArgs = (extra: string[]) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(cmsDir, 'package.json'), 'utf8'))
  const [, ...words] = (pkg.scripts.seed as string).split(/\s+/)
  const argv = [...words.map((w) => (w === 'scripts/seed.ts' ? stub : w)), ...extra]
  const result = spawnSync(process.execPath, ['node_modules/payload/bin.js', ...argv], {
    cwd: cmsDir,
    encoding: 'utf8',
  })
  const line = result.stdout.split('\n').find((l) => l.startsWith('ARGS:'))
  return JSON.parse(line?.slice('ARGS:'.length) ?? 'null') as string[] | null
}

describe('pnpm seed --force', () => {
  // Starting the Payload CLI takes several seconds on a cold machine.
  it('hands --force to the script', { timeout: 60_000 }, () => {
    expect(seedArgs(['--force'])).toEqual(['--force'])
  })

  it('hands nothing over without the flag', { timeout: 60_000 }, () => {
    expect(seedArgs([])).toEqual([])
  })
})
