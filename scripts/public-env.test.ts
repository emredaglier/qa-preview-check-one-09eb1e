// Tests of scripts/public-env.ts, and the repo guard for the build-time half of "no secrets in the bundle" (the run-time half is
// smoke/secrets.spec.ts, which reads what the container serves). Next inlines `NEXT_PUBLIC_*` values
// into browser code at build time, so a secret under that prefix ships to every visitor; and a
// client component that reads a server variable is a sign a secret is about to be passed to it.
// Not behaviour: it enforces a rule that no test can run, because the value is only dangerous once
// a project has set it.
//
// Adapted from darkroom.engineering's Satus (e2e/secrets-in-bundle.e2e.ts, MIT; see
// THIRD-PARTY-NOTICES.md), which fails when a server secret in its env schema reaches `.next`.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { publicEnvProblems } from './public-env.ts'

const root = path.resolve(import.meta.dirname, '..')

describe('publicEnvProblems (on broken fixtures)', () => {
  it('finds a secret under the public prefix in any file', () => {
    for (const name of [
      'NEXT_PUBLIC_API_SECRET',
      'NEXT_PUBLIC_ADMIN_TOKEN',
      'NEXT_PUBLIC_DB_PASSWORD',
    ]) {
      expect(publicEnvProblems('apps/web/.env.example', `${name}=x`), name).toHaveLength(1)
    }
    expect(publicEnvProblems('Dockerfile', 'ARG NEXT_PUBLIC_STRIPE_PRIVATE_KEY')).toHaveLength(1)
  })

  it('finds a server variable read in a client component, but not NODE_ENV or a public one', () => {
    const client = `'use client'\nconst a = process.env.PAYLOAD_SECRET\nconst b = process.env.NODE_ENV\nconst c = process.env.NEXT_PUBLIC_SITE_URL`
    expect(publicEnvProblems('apps/web/src/Box.tsx', client)).toEqual([
      'apps/web/src/Box.tsx: a client component reads process.env.PAYLOAD_SECRET, a server variable',
    ])
    // A license comment above the directive is still a client component.
    expect(
      publicEnvProblems('a.tsx', `/* x */\n'use client'\nprocess.env.REVALIDATE_SECRET`),
    ).toHaveLength(1)
  })

  it('knows a client component by its directive after comments and blank lines', () => {
    const read = 'process.env.PAYLOAD_SECRET'
    for (const head of [
      `// a note\n\n'use client'\n`,
      `// one\n// two\n\n\n"use client"\n`,
      `/* licence */\n\n// note\n\n'use client'\n`,
      `\n\n'use client'\n`,
    ]) {
      expect(publicEnvProblems('a.tsx', `${head}${read}`), head).toHaveLength(1)
    }
    // The directive must come first: after code it is only a string.
    expect(publicEnvProblems('a.tsx', `import x from 'x'\n'use client'\n${read}`)).toEqual([])
  })

  it('finds a server variable read by bracket access', () => {
    for (const read of [
      `process.env['PAYLOAD_SECRET']`,
      `process.env["PAYLOAD_SECRET"]`,
      `process.env[ 'PAYLOAD_SECRET' ]`,
      'process.env[`PAYLOAD_SECRET`]',
    ]) {
      expect(publicEnvProblems('a.tsx', `'use client'\nconst s = ${read}`), read).toEqual([
        'a.tsx: a client component reads process.env.PAYLOAD_SECRET, a server variable',
      ])
    }
    expect(
      publicEnvProblems(
        'a.tsx',
        `'use client'\nprocess.env['NODE_ENV']; process.env['NEXT_PUBLIC_X']`,
      ),
    ).toEqual([])
  })

  it('finds a server variable read by destructuring process.env', () => {
    const problems = (read: string) => publicEnvProblems('a.tsx', `'use client'\n${read}`)
    const reads = (name: string) => [
      `a.tsx: a client component reads process.env.${name}, a server variable`,
    ]
    expect(problems('const { PAYLOAD_SECRET } = process.env')).toEqual(reads('PAYLOAD_SECRET'))
    expect(problems('const { PAYLOAD_SECRET: secret } = process.env')).toEqual(
      reads('PAYLOAD_SECRET'),
    )
    expect(problems("const { PAYLOAD_SECRET = 'x' } = process.env")).toEqual(
      reads('PAYLOAD_SECRET'),
    )
    expect(problems('const {\n  NODE_ENV,\n  REVALIDATE_SECRET,\n} = process.env')).toEqual(
      reads('REVALIDATE_SECRET'),
    )
    expect(problems('const { NODE_ENV, NEXT_PUBLIC_SITE_URL: url } = process.env')).toEqual([])
  })

  it('lets a server file read what it needs, and a public key be public', () => {
    expect(publicEnvProblems('route.ts', 'const s = process.env.REVALIDATE_SECRET')).toEqual([])
    expect(publicEnvProblems('.env.example', 'NEXT_PUBLIC_MAPS_KEY=abc')).toEqual([])
  })
})

describe('this repository', () => {
  it('has no secret under NEXT_PUBLIC_ and no server variable read in a client component', () => {
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean)
      .filter(
        (file) =>
          !/^(?:docs|\.scratch)\//.test(file) &&
          file !== 'pnpm-lock.yaml' &&
          file !== 'scripts/public-env.test.ts' &&
          !/\.(?:png|jpe?g|webp|avif|gif|ico|woff2?|db|mp4|webm|pdf)$/i.test(file) &&
          fs.existsSync(path.join(root, file)),
      )
    const problems = tracked.flatMap((file) =>
      publicEnvProblems(file, fs.readFileSync(path.join(root, file), 'utf8')),
    )
    expect(problems).toEqual([])
  })
})
