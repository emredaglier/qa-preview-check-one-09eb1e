// Repo guards (CODING_STANDARDS.md): what an owner must fill in is written down. They read the
// parsed workflows, project.env, the README and the scripts' sources on purpose; none of them is
// behaviour.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { parseProjectEnv } from './settings'
import { allStrings, loadWorkflow, workflowFiles } from './workflows'

const infra = import.meta.dirname
const read = (file: string) => fs.readFileSync(path.join(infra, file), 'utf8')
const readme = read('README.md')

describe('setup docs list what the owner fills in', () => {
  // ADR-0005: the pipeline skips until the owner sets its secrets, so each one must be findable.
  it('names every secret and variable a workflow reads', () => {
    const names = new Set(
      workflowFiles()
        .flatMap((file) => allStrings(loadWorkflow(file)))
        .flatMap((text) => [...text.matchAll(/\b(?:secrets|vars)\.([A-Z][A-Z0-9_]*)/g)])
        .map((m) => m[1]!)
        // Automatic: no secret to create.
        .filter((name) => name !== 'GITHUB_TOKEN'),
    )
    expect(names.size).toBeGreaterThan(5)
    for (const name of names) expect(readme, name).toContain(`\`${name}\``)
  })

  it('documents every key of infra/project.env', () => {
    const keys = Object.keys(parseProjectEnv(read('project.env').replace(/^# ([A-Z_]+=)/gm, '$1')))
    expect(keys.sort()).toEqual(['CDN_HOST', 'DOMAIN', 'PROJECT_NAME', 'TIMEZONE', 'TS_HOSTNAME'])
    for (const key of keys) expect(readme, key).toContain(`\`${key}\``)
  })

  // ADR-0001: every per-project name comes from infra/project.env.
  it('has no hard-coded server folder in a script', () => {
    // A leftover default would deploy under the wrong name.
    for (const file of [
      'compose.yaml',
      'compose.local.yaml',
      'deploy.sh',
      'ci.sh',
      'bootstrap.sh',
    ]) {
      expect(read(file), file).not.toMatch(/\/opt\/[a-z]/)
    }
  })
})
