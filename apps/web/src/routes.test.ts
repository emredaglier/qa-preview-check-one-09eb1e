import fs from 'node:fs'
import path from 'node:path'

import { expect, it } from 'vitest'

import config from '../next.config'

const appDir = path.resolve(import.meta.dirname, 'app')

/** Every route segment folder under `app/`, as a path like `internal/health`. */
const segments = (dir: string, prefix = ''): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return []
    const route = `${prefix}${entry.name}`
    return [route, ...segments(path.join(dir, entry.name), `${route}/`)]
  })

it('has no /admin and no /api route: the public site is not the CMS (ADR-0002)', () => {
  // Strip route groups `(x)`, then look at each URL segment.
  const urlSegments = segments(appDir).flatMap((route) =>
    route
      .split('/')
      .filter((part) => !/^\(.*\)$/.test(part))
      .map((part) => part.toLowerCase()),
  )
  expect(urlSegments.filter((part) => part === 'admin' || part === 'api')).toEqual([])
})

it('keeps its only internal routes under /internal, which the proxy never serves publicly', () => {
  const internal = segments(appDir).filter((route) => route.startsWith('internal/'))
  expect(internal.sort()).toEqual(['internal/health', 'internal/revalidate'])
})

it('has no Pages Router, which would add routes the app folder test does not see', () => {
  const web = path.resolve(import.meta.dirname, '..')
  expect(fs.existsSync(path.join(web, 'src/pages'))).toBe(false)
  expect(fs.existsSync(path.join(web, 'pages'))).toBe(false)
})

it('has no rewrites in its Next config, which could map a public path to /admin or /api', () => {
  expect(config.rewrites).toBeUndefined()
})
