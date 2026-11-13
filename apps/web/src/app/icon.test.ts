import fs from 'node:fs'
import path from 'node:path'

import { expect, it } from 'vitest'

it('gives the favicon an accessible title', () => {
  const svg = fs.readFileSync(path.resolve(import.meta.dirname, 'icon.svg'), 'utf8')
  expect(svg).toMatch(/<title>[^<]+<\/title>/)
})
