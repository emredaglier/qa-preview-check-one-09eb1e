// AGENTS.md is loaded into every agent turn of every project made from the starter, so it stays
// short. Words are counted as `wc -w` counts them: runs of non-whitespace.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FILE = 'AGENTS.md'
const CAP = 1000

describe('AGENTS.md word cap', () => {
  it(`stays within ${CAP} words`, () => {
    const words = fs.readFileSync(path.join(root, FILE), 'utf8').split(/\s+/).filter(Boolean).length
    expect(words, `${FILE} has ${words} words, over the ${CAP}-word cap`).toBeLessThanOrEqual(CAP)
  })
})
