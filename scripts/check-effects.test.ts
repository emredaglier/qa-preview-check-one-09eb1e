import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const script = path.resolve(import.meta.dirname, 'check-effects.mjs')
const dirs: string[] = []

const fixtureDir = (files: Record<string, string>) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-effects-'))
  dirs.push(dir)
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
    fs.writeFileSync(path.join(dir, name), content)
  }
  return dir
}

const run = (dir: string) => {
  const result = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' })
  return { code: result.status, stderr: result.stderr }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('check-effects', () => {
  it('fails on a CSS filter pointing at an SVG filter', () => {
    const dir = fixtureDir({ 'src/app/globals.css': '.effect {\n  filter: url(#x);\n}\n' })
    const { code, stderr } = run(dir)
    expect(code).toBe(1)
    expect(stderr).toContain('globals.css:2:')
  })

  it('fails on SVG filter elements in TSX', () => {
    const dir = fixtureDir({
      'src/Effect.tsx': '<svg>\n  <filter id="x">\n    <feColorMatrix />\n  </filter>\n</svg>\n',
    })
    const { code, stderr } = run(dir)
    expect(code).toBe(1)
    expect(stderr).toContain('Effect.tsx:2:')
    expect(stderr).toContain('Effect.tsx:3:')
  })

  it('fails on :active-view-transition-type()', () => {
    const dir = fixtureDir({
      'src/transition.css': 'html:active-view-transition-type(slide) { color: red; }\n',
    })
    expect(run(dir).code).toBe(1)
  })

  it('still checks code that starts with * or follows a comment on the same line', () => {
    const dir = fixtureDir({
      'src/reset.css': '* { filter: url(#x); }\n/* effect */ .a { filter: url(#y); }\n',
    })
    const { code, stderr } = run(dir)
    expect(code).toBe(1)
    expect(stderr).toContain('reset.css:1:')
    expect(stderr).toContain('reset.css:2:')
  })

  it('passes on clean files and ignores comments, node_modules and build output', () => {
    const dir = fixtureDir({
      'src/app/globals.css': '/* never use filter: url(#x) */\n.a { filter: blur(2px); }\n',
      'src/Page.tsx':
        '/**\n * no <filter> here\n */\nexport const Page = () => <svg /> // nor <filter>\n',
      'src/links.css': '.a { background: url(//cdn.example.com/a.webp); }\n',
      'node_modules/pkg/index.css': '.a { filter: url(#x); }\n',
      '.next/static/app.css': '.a { filter: url(#x); }\n',
    })
    expect(run(dir)).toEqual({ code: 0, stderr: '' })
  })

  it('runs as part of lint', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(import.meta.dirname, '../package.json'), 'utf8'),
    ) as { scripts: Record<string, string> }
    expect(pkg.scripts.lint).toContain('node scripts/check-effects.mjs')
  })
})
