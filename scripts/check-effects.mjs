// Keeps the site's effects cross-browser: fails if SVG filters or a browser-specific transition
// selector creep back in. Safari draws SVG filters on the CPU and ignores some of them, so
// effects are drawn on the GPU (WebGL2) or in CSS instead; and not every browser has
// :active-view-transition-type(), so transitions are keyed on an attribute on <html> that code
// sets (for example html[data-transition]).
//
// Usage: node scripts/check-effects.mjs [dir...]   (defaults to every workspace package)
import fs from 'node:fs'
import path from 'node:path'

const WORKSPACES = ['apps', 'packages']
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '(payload)',
  'migrations',
])
const SKIP_FILES = new Set(['payload-types.ts'])
const FORBIDDEN = [
  [/url\(#/, 'a CSS filter pointing at an SVG filter (filter: url(#id))'],
  [/<filter[\s>]/, 'an SVG <filter> element'],
  [/<feColorMatrix/, 'an SVG filter primitive'],
  [
    /:active-view-transition-type\(/,
    'the :active-view-transition-type() selector (key transitions on an html[data-*] attribute)',
  ],
]

const defaultRoots = () =>
  WORKSPACES.filter((dir) => fs.existsSync(dir)).flatMap((dir) =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dir, entry.name)),
  )

const files = []
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full)
    } else if (/\.(tsx?|css)$/.test(entry.name) && !SKIP_FILES.has(entry.name)) {
      files.push(full)
    }
  }
}
const roots = process.argv.length > 2 ? process.argv.slice(2) : defaultRoots()
roots.forEach(walk)

// Blanks out comments but keeps their newlines, so reported line numbers stay right. CSS has no
// line comments (and has url(//host)), so `//` is only stripped from TS, and never after a `:`.
const stripComments = (source, file) => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ''))
  return file.endsWith('.css') ? code : code.replace(/(^|[^:])\/\/.*$/gm, '$1')
}

let failed = 0
for (const file of files) {
  const lines = stripComments(fs.readFileSync(file, 'utf8'), file).split('\n')
  lines.forEach((line, index) => {
    for (const [pattern, what] of FORBIDDEN) {
      if (pattern.test(line)) {
        failed++
        console.error(`${path.relative(process.cwd(), file)}:${index + 1}: ${what}`)
      }
    }
  })
}
if (failed) {
  console.error(
    `\n${failed} cross-browser problem(s). See the comment at the top of scripts/check-effects.mjs.`,
  )
  process.exit(1)
}
console.log(`check-effects: ok (${files.length} files)`)
