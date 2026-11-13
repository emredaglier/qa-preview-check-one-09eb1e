// Per-project settings (infra/project.env), for TypeScript callers: the smoke suite and the tests.
// `infra/project.sh` does the same for the shell scripts, and project.test.ts checks that the two
// agree. A name read from the environment wins over the file, so a test or a one-off run can
// override any value.
import fs from 'node:fs'
import path from 'node:path'

/** `KEY=value` lines. Comments (`#`) and blank lines are skipped; nothing is evaluated. */
export function parseProjectEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (match) values[match[1]!] = match[2]!.trim()
  }
  return values
}

/** A release name (an image tag, a folder on the CDN). infra/project.sh has the same pattern. */
export const RELEASE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

export type ProjectSettings = {
  projectName: string
  domain: string
  cdnHost: string
  cdnOrigin: string
  tsHostname: string
  timezone: string
  appDir: string
  envDir: string
  dataDir: string
  certsDir: string
  stateDir: string
  mediaBucket: string
  dbBackupBucket: string
  mediaBackupBucket: string
}

/** Fills in the derived names. `file` holds the parsed project.env, `env` the process environment. */
export function resolveSettings(
  file: Record<string, string>,
  env: Record<string, string | undefined> = process.env,
): ProjectSettings {
  const read = (name: string): string | undefined => env[name] || file[name] || undefined
  const projectName = read('PROJECT_NAME')
  const domain = read('DOMAIN')
  if (!projectName || !/^[a-z][a-z0-9-]{1,30}$/.test(projectName)) {
    throw new Error(
      `PROJECT_NAME must be 2-31 lowercase letters, digits or hyphens, starting with a letter (got '${projectName ?? ''}'). Edit infra/project.env.`,
    )
  }
  if (
    !domain ||
    !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)
  ) {
    throw new Error(
      `DOMAIN must be a bare host name such as example.com (got '${domain ?? ''}'). Edit infra/project.env.`,
    )
  }
  const cdnHost = read('CDN_HOST') ?? `cdn.${domain}`
  const appDir = read('APP_DIR') ?? `/opt/${projectName}`
  return {
    projectName,
    domain,
    cdnHost,
    cdnOrigin: read('CDN_ORIGIN') ?? `https://${cdnHost}`,
    tsHostname: read('TS_HOSTNAME') ?? projectName,
    timezone: read('TIMEZONE') ?? 'UTC',
    appDir,
    envDir: read('ENV_DIR') ?? `${appDir}/env`,
    dataDir: read('DATA_DIR') ?? `${appDir}/data`,
    certsDir: read('CERTS_DIR') ?? `${appDir}/certs`,
    stateDir: read('STATE_DIR') ?? `${appDir}/state`,
    mediaBucket: read('R2_MEDIA_BUCKET') ?? `${projectName}-media`,
    dbBackupBucket: read('R2_DB_BACKUP_BUCKET') ?? `${projectName}-db-backups`,
    mediaBackupBucket: read('R2_MEDIA_BACKUP_BUCKET') ?? `${projectName}-backup`,
  }
}

/** The default file is `infra/project.env` next to this module. */
export function loadSettings(
  file: string = path.join(import.meta.dirname, 'project.env'),
  env: Record<string, string | undefined> = process.env,
): ProjectSettings {
  return resolveSettings(parseProjectEnv(fs.readFileSync(file, 'utf8')), env)
}
