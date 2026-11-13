// The public routes the browser checks sweep, discovered from the pages in `apps/web/src/app` so
// that a new page is covered without anyone remembering to list it (the route sweep). Pure apart
// from reading the folder, so it is unit-tested.
//
// Adapted from darkroom.engineering's Satus (e2e/route-sweep.e2e.ts, MIT; see
// THIRD-PARTY-NOTICES.md): it finds every static `page.tsx` the same way.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const APP_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../apps/web/src/app',
)

/**
 * One URL for each dynamic page, keyed by the page's pattern: `'/work/[slug]': '/work/first'`.
 * A route with a parameter cannot be visited without a value, so the project names one that its
 * seed data serves. `publicRoutes` throws, and so fails the unit test, for a dynamic page without
 * a sample, so a new dynamic page cannot be left out of the sweep.
 */
export const DYNAMIC_ROUTE_SAMPLES: Record<string, string> = {}

const PAGE_FILE = /^page\.(?:tsx|ts|jsx|js)$/

/**
 * A folder that is no route: a parallel slot (`@modal`), a private folder (`_components`) or an
 * intercepting route (`(.)photo`, `(..)photo`, `(..)(..)photo`, `(...)photo`), which shows another
 * URL's page in place. That page is found where it lives, so the interceptor is left out whole.
 */
const isNoRoute = (name: string) =>
  name.startsWith('@') || name.startsWith('_') || /^\(\.{1,3}\)/.test(name)

/** A route group, `(site)`: it organises folders and adds no URL segment. */
const isGroup = (name: string) => name.startsWith('(') && name.endsWith(')')

const isDynamic = (segment: string) => segment.includes('[')

export type Discovered = { static: string[]; dynamic: string[] }

/** Every page under `appDir` as its URL: static ones apart from those with a parameter. */
export function discoverRoutes(appDir: string): Discovered {
  const found: string[] = []
  const walk = (dir: string, segments: string[]) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (isNoRoute(entry.name)) continue
        walk(path.join(dir, entry.name), isGroup(entry.name) ? segments : [...segments, entry.name])
      } else if (entry.isFile() && PAGE_FILE.test(entry.name)) {
        found.push(`/${segments.join('/')}`)
      }
    }
  }
  if (fs.existsSync(appDir)) walk(appDir, [])
  const unique = [...new Set(found)].sort()
  return {
    static: unique.filter((route) => !isDynamic(route)),
    dynamic: unique.filter(isDynamic),
  }
}

/** Every URL to sweep: the static pages and each dynamic page's sample. */
export function publicRoutes(
  appDir: string = APP_DIR,
  samples: Record<string, string> = DYNAMIC_ROUTE_SAMPLES,
): string[] {
  const { static: pages, dynamic } = discoverRoutes(appDir)
  const missing = dynamic.filter((route) => !(route in samples))
  if (missing.length > 0) {
    throw new Error(
      `no sample URL for the dynamic page(s) ${missing.join(', ')}: add one to DYNAMIC_ROUTE_SAMPLES in smoke/routes.ts`,
    )
  }
  const stale = Object.keys(samples).filter((route) => !dynamic.includes(route))
  if (stale.length > 0) {
    throw new Error(
      `DYNAMIC_ROUTE_SAMPLES names ${stale.join(', ')}, which is not a dynamic page: remove it from smoke/routes.ts`,
    )
  }
  return [...pages, ...dynamic.map((route) => samples[route]!)]
}
