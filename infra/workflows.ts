// The GitHub workflows as parsed YAML, for the repo guards (CODING_STANDARDS.md, "Repo guards").
// A guard asserts the structure of a workflow (which job needs which, what triggers it), never the
// literal text of the file.
import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'

export const workflowsDir = path.resolve(import.meta.dirname, '../.github/workflows')

export type Step = {
  name?: string
  id?: string
  if?: string
  uses?: string
  run?: string
  env?: Record<string, string>
  with?: Record<string, unknown>
  'continue-on-error'?: boolean
  'timeout-minutes'?: number
}

export type Job = {
  name?: string
  needs?: string | string[]
  if?: string
  permissions?: Record<string, string>
  concurrency?: { group: string; 'cancel-in-progress': boolean }
  env?: Record<string, string>
  outputs?: Record<string, string>
  steps: Step[]
}

export type Workflow = {
  name: string
  on: Record<string, unknown>
  permissions?: Record<string, string>
  env?: Record<string, string>
  jobs: Record<string, Job>
}

export const workflowFiles = (): string[] =>
  fs
    .readdirSync(workflowsDir)
    .filter((file) => file.endsWith('.yml'))
    .map((file) => path.join(workflowsDir, file))

export const loadWorkflow = (file: string): Workflow =>
  parse(fs.readFileSync(file, 'utf8')) as Workflow

/** The jobs a job waits for, as a list. */
export const needsOf = (job: Job): string[] =>
  job.needs === undefined ? [] : Array.isArray(job.needs) ? job.needs : [job.needs]

/** Every string value anywhere in a parsed document (expressions, commands, names). */
export const allStrings = (node: unknown): string[] =>
  typeof node === 'string'
    ? [node]
    : Array.isArray(node)
      ? node.flatMap(allStrings)
      : node && typeof node === 'object'
        ? Object.values(node).flatMap(allStrings)
        : []

/** The lines of every `run` step of a workflow, without blank lines and comment lines. */
export const commandLines = (workflow: Workflow): string[] =>
  Object.values(workflow.jobs).flatMap((job) =>
    job.steps.flatMap((step) =>
      (step.run ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#')),
    ),
  )
