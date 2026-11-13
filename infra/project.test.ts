import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { loadSettings, parseProjectEnv, RELEASE_NAME_PATTERN, resolveSettings } from './settings'

const infra = import.meta.dirname

/** What `infra/project.sh` exports, read by sourcing it in a clean shell. */
function shellSettings(file: string, env: Record<string, string> = {}) {
  const names = [
    'PROJECT_NAME',
    'DOMAIN',
    'CDN_HOST',
    'CDN_ORIGIN',
    'TS_HOSTNAME',
    'TIMEZONE',
    'APP_DIR',
    'ENV_DIR',
    'DATA_DIR',
    'CERTS_DIR',
    'STATE_DIR',
    'R2_MEDIA_BUCKET',
    'R2_DB_BACKUP_BUCKET',
    'R2_MEDIA_BACKUP_BUCKET',
  ]
  const script = `. "${infra}/project.sh"; ${names.map((n) => `echo "${n}=\${${n}-}"`).join('; ')}`
  const result = spawnSync('bash', ['-c', script], {
    env: { PATH: process.env.PATH ?? '', PROJECT_ENV_FILE: file, ...env },
    encoding: 'utf8',
  })
  return { status: result.status, stderr: result.stderr, values: parseProjectEnv(result.stdout) }
}

function settingsFile(text: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-settings-'))
  const file = path.join(dir, 'project.env')
  fs.writeFileSync(file, text)
  return file
}

describe('parseProjectEnv', () => {
  it('reads KEY=value lines and skips comments and blank lines', () => {
    expect(parseProjectEnv('# c\n\nA=1\n  # c\nB=two words\nC=\n')).toEqual({
      A: '1',
      B: 'two words',
      C: '',
    })
  })

  it('keeps an = inside a value', () => {
    expect(parseProjectEnv('A=b=c')).toEqual({ A: 'b=c' })
  })
})

describe('resolveSettings', () => {
  it('derives every name from PROJECT_NAME and DOMAIN', () => {
    const s = resolveSettings({ PROJECT_NAME: 'atlas', DOMAIN: 'atlas.studio' }, {})
    expect(s).toMatchObject({
      projectName: 'atlas',
      domain: 'atlas.studio',
      cdnHost: 'cdn.atlas.studio',
      cdnOrigin: 'https://cdn.atlas.studio',
      tsHostname: 'atlas',
      timezone: 'UTC',
      appDir: '/opt/atlas',
      envDir: '/opt/atlas/env',
      dataDir: '/opt/atlas/data',
      certsDir: '/opt/atlas/certs',
      stateDir: '/opt/atlas/state',
      mediaBucket: 'atlas-media',
      dbBackupBucket: 'atlas-db-backups',
      mediaBackupBucket: 'atlas-backup',
    })
  })

  it('lets an explicit value win over a derived one, and the environment win over the file', () => {
    const s = resolveSettings(
      { PROJECT_NAME: 'atlas', DOMAIN: 'atlas.studio', CDN_HOST: 'files.atlas.studio' },
      { DOMAIN: 'other.studio', TIMEZONE: 'Europe/Berlin' },
    )
    expect(s.domain).toBe('other.studio')
    expect(s.cdnHost).toBe('files.atlas.studio')
    expect(s.timezone).toBe('Europe/Berlin')
  })

  it.each([
    ['a name with upper case', { PROJECT_NAME: 'Atlas', DOMAIN: 'a.studio' }],
    ['a name starting with a digit', { PROJECT_NAME: '1atlas', DOMAIN: 'a.studio' }],
    ['a name with a slash', { PROJECT_NAME: 'a/b', DOMAIN: 'a.studio' }],
    ['no name', { DOMAIN: 'a.studio' }],
    ['no domain', { PROJECT_NAME: 'atlas' }],
    ['a domain with a scheme', { PROJECT_NAME: 'atlas', DOMAIN: 'https://a.studio' }],
    ['a domain with no dot', { PROJECT_NAME: 'atlas', DOMAIN: 'localhost' }],
  ])('rejects %s', (_label, raw) => {
    expect(() => resolveSettings(raw, {})).toThrow()
  })
})

describe('the committed infra/project.env', () => {
  it('is valid and still carries the template placeholders until a project fills it in', () => {
    const s = loadSettings(path.join(infra, 'project.env'), {})
    expect(s.projectName).toMatch(/^[a-z][a-z0-9-]*$/)
    expect(s.domain).toContain('.')
  })
})

describe('infra/project.sh agrees with settings.ts', () => {
  it('derives the same values from the same file', () => {
    const file = settingsFile('PROJECT_NAME=atlas\nDOMAIN=atlas.studio\nTIMEZONE=Europe/Berlin\n')
    const shell = shellSettings(file)
    const ts = loadSettings(file, {})
    expect(shell.status).toBe(0)
    expect(shell.values).toEqual({
      PROJECT_NAME: ts.projectName,
      DOMAIN: ts.domain,
      CDN_HOST: ts.cdnHost,
      CDN_ORIGIN: ts.cdnOrigin,
      TS_HOSTNAME: ts.tsHostname,
      TIMEZONE: ts.timezone,
      APP_DIR: ts.appDir,
      ENV_DIR: ts.envDir,
      DATA_DIR: ts.dataDir,
      CERTS_DIR: ts.certsDir,
      STATE_DIR: ts.stateDir,
      R2_MEDIA_BUCKET: ts.mediaBucket,
      R2_DB_BACKUP_BUCKET: ts.dbBackupBucket,
      R2_MEDIA_BACKUP_BUCKET: ts.mediaBackupBucket,
    })
  })

  it('lets the environment win over the file', () => {
    const file = settingsFile('PROJECT_NAME=atlas\nDOMAIN=atlas.studio\n')
    const shell = shellSettings(file, { DOMAIN: 'other.studio', ENV_DIR: '/srv/env' })
    expect(shell.values.DOMAIN).toBe('other.studio')
    expect(shell.values.CDN_ORIGIN).toBe('https://cdn.other.studio')
    expect(shell.values.ENV_DIR).toBe('/srv/env')
  })

  it('stops with a message that names the file when the name is invalid', () => {
    const file = settingsFile('PROJECT_NAME=Bad Name\nDOMAIN=a.studio\n')
    const shell = shellSettings(file)
    expect(shell.status).not.toBe(0)
    expect(shell.stderr).toContain('PROJECT_NAME')
  })

  it('does not run code written in the file', () => {
    const marker = path.join(os.tmpdir(), `project-sh-ran-${process.pid}`)
    const file = settingsFile(`PROJECT_NAME=atlas\nDOMAIN=a.studio\nTIMEZONE=$(touch ${marker})\n`)
    shellSettings(file)
    expect(fs.existsSync(marker)).toBe(false)
  })

  it('require_configured refuses the template placeholder domain', () => {
    const run = (domain: string) =>
      spawnSync('bash', ['-c', `. "${infra}/project.sh"; require_configured && echo configured`], {
        env: {
          PATH: process.env.PATH ?? '',
          PROJECT_ENV_FILE: settingsFile(`PROJECT_NAME=atlas\nDOMAIN=${domain}\n`),
        },
        encoding: 'utf8',
      })
    expect(run('example.com').status).not.toBe(0)
    expect(run('example.com').stderr).toContain('project.env')
    expect(run('atlas.studio').stdout).toContain('configured')
  })
})

describe('release names', () => {
  const accepted = ['v1.2.3', 'v1.2.3-rc.1', 'a'.repeat(100), '0a1b2c3', 'release_2', 'x']
  const rejected = ['', '../x', 'v1/2', '-v1', '.v1', '_v1', 'v 1', 'a'.repeat(101), 'v1;ls', 'é']
  const shellAccepts = (name: string) =>
    spawnSync('bash', ['-c', `. "${infra}/project.sh"; valid_release_name "$1"`, '_', name], {
      env: { PATH: process.env.PATH ?? '', PROJECT_NAME: 'atlas', DOMAIN: 'atlas.studio' },
    }).status === 0

  // deploy.sh and ci.sh call the shell function; release-assets.ts uses the TypeScript pattern.
  it('project.sh and settings.ts accept and reject the same names', () => {
    for (const name of accepted) {
      expect(shellAccepts(name), name).toBe(true)
      expect(RELEASE_NAME_PATTERN.test(name), name).toBe(true)
    }
    for (const name of rejected) {
      expect(shellAccepts(name), name).toBe(false)
      expect(RELEASE_NAME_PATTERN.test(name), name).toBe(false)
    }
  })
})
