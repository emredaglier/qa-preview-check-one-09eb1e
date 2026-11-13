// Repo guard (CODING_STANDARDS.md): the seed that `migrate` runs must tell the same web instances
// to drop their cache as `cms` does, or a seeded page stays stale (ADR-0010). Docker is not run
// here, so it reads the parsed Compose files, not their text.
import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

type Service = { env_file?: string | string[]; environment?: Record<string, string> }
type Compose = { services: Record<string, Service> }

// `!reset` and `!override` are Compose merge tags the parser does not know; it keeps the plain value
// (and `logLevel` keeps it quiet about the tags), which is all the guard reads.
const load = (file: string) =>
  parse(fs.readFileSync(path.resolve(import.meta.dirname, file), 'utf8'), {
    logLevel: 'error',
  }) as Compose

const base = load('compose.yaml')
const local = load('compose.local.yaml')
const asList = (value: string | string[] | undefined) =>
  value === undefined ? [] : Array.isArray(value) ? value : [value]

describe('compose: seed revalidation', () => {
  it('migrate (where the seed runs) posts to the same web instances as cms', () => {
    const cms = base.services.cms?.environment?.REVALIDATE_URLS
    expect(cms).toContain('web:3000')
    expect(cms).toContain('web-preview:3000')
    expect(base.services.migrate?.environment?.REVALIDATE_URLS).toBe(cms)
  })

  it('migrate keeps a REVALIDATE_SECRET wherever it has the URLs, or config.ts throws', () => {
    expect(asList(base.services.migrate?.env_file).some((f) => f.endsWith('/cms.env'))).toBe(true)
    // The laptop override gives migrate and cms the same environment, secret included.
    const secret = local.services.cms?.environment?.REVALIDATE_SECRET
    expect(secret).toBeTruthy()
    expect(local.services.migrate?.environment).toEqual(local.services.cms?.environment)
  })
})
