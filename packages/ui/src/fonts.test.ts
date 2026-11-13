import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const SKIP = new Set(['node_modules', 'dist', '.claude', '.git'])
const skipped = (name: string) => SKIP.has(name) || name.startsWith('.next')

const sources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return skipped(entry.name) ? [] : sources(full)
    return /\.(tsx?|css|mjs)$/.test(entry.name) ? [full] : []
  })

it('defines fonts only in packages/ui/fonts.ts (ADR-0001)', () => {
  const allowed = path.join(repo, 'packages/ui/fonts.ts')
  const offenders = [...sources(path.join(repo, 'apps')), ...sources(path.join(repo, 'packages'))]
    .filter((file) => file !== allowed && file !== fileURLToPath(import.meta.url))
    .filter((file) => /next\/font|@font-face/.test(fs.readFileSync(file, 'utf8')))
  expect(offenders.map((file) => path.relative(repo, file))).toEqual([])
})
