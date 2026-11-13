// The nightly backup step (ADR-0009), run for real against a fake `rclone` that records its calls.
// The workflow's structure (only copying commands, a pinned rclone) is guarded in workflows.test.ts.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadWorkflow, workflowsDir } from './workflows'

const workflow = loadWorkflow(path.join(workflowsDir, 'media-backup.yml'))
const step = Object.values(workflow.jobs)
  .flatMap((job) => job.steps)
  .find((s) => s.name === 'Copy new media and check the backup')
if (!step?.run) throw new Error('media-backup.yml has no copy step')
const script = step.run

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-backup-'))
  fs.mkdirSync(`${dir}/bin`)
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

/** `failing` names the rclone command that exits 1; `copyLog` is what `copy` prints. */
const run = (options: { failing?: string; copyLog?: string } = {}) => {
  fs.writeFileSync(
    `${dir}/bin/rclone`,
    `#!/usr/bin/env bash
echo "$*" >>"${dir}/calls"
[[ "$1" == "$FAKE_FAILING" ]] && exit 1
case "$1" in
  lsf) printf 'a.jpg\\nb.jpg\\n' ;;
  copy) echo "$FAKE_COPY_LOG" ;;
esac
exit 0
`,
    { mode: 0o755 },
  )
  fs.writeFileSync(`${dir}/calls`, '')
  fs.mkdirSync(`${dir}/tmp`)
  // GitHub runs a step's script with `bash -e -o pipefail`.
  const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
    encoding: 'utf8',
    env: {
      PATH: `${dir}/bin:${process.env.PATH ?? ''}`,
      RUNNER_TEMP: `${dir}/tmp`,
      GITHUB_STEP_SUMMARY: `${dir}/summary`,
      SRC_BUCKET: 'atlas-media',
      DST_BUCKET: 'atlas-backup',
      FAKE_FAILING: options.failing ?? '',
      FAKE_COPY_LOG: options.copyLog ?? '',
    },
  })
  const calls = fs.readFileSync(`${dir}/calls`, 'utf8').trim().split('\n')
  return { status: result.status, out: result.stdout + result.stderr, calls }
}

describe('the nightly media backup step', () => {
  it('lists, copies and then checks, using only commands that cannot delete', () => {
    const { status, calls } = run()
    expect(status).toBe(0)
    expect(calls.map((c) => c.split(' ')[0])).toEqual(['lsf', 'copy', 'check'])
    for (const call of calls) expect(call).not.toMatch(/delete|remove|purge|sync|move/i)
  })

  it('copies from the media bucket to the backup bucket, and never the static releases or the trash', () => {
    const { calls } = run()
    const copy = calls.find((c) => c.startsWith('copy '))!
    expect(copy).toContain('SRC:atlas-media DST:atlas-backup')
    expect(copy).toContain('--exclude _next/**')
    expect(copy).toContain('--exclude trash/**')
    // The listing the check relies on skips the same things.
    const list = calls.find((c) => c.startsWith('lsf '))!
    expect(list).toContain('--exclude _next/**')
    expect(list).toContain('--exclude trash/**')
  })

  it('checks that every listed object is in the backup, one way, after the copy', () => {
    const { calls } = run()
    const check = calls.find((c) => c.startsWith('check '))!
    expect(check).toContain('SRC:atlas-media DST:atlas-backup')
    expect(check).toContain('--one-way')
    expect(check).toMatch(/--files-from \S+listed\.txt/)
  })

  it('fails when the check finds a listed object missing from the backup', () => {
    const { status } = run({ failing: 'check' })
    expect(status).not.toBe(0)
  })

  it('fails, without checking, when the copy fails', () => {
    const { status, calls } = run({ failing: 'copy' })
    expect(status).not.toBe(0)
    expect(calls.some((c) => c.startsWith('check '))).toBe(false)
  })

  it('warns in the run summary when the copy only succeeded on a retry', () => {
    const { out } = run({ copyLog: 'ERROR : a.jpg: upload failed, retrying' })
    expect(out).toContain('::warning title=Backup copy::')
    expect(fs.readFileSync(`${dir}/summary`, 'utf8')).toContain('Backup copy')
  })
})
