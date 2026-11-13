import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { APP_DIR, discoverRoutes, publicRoutes } from './routes.ts'

let app: string
const page = (relative: string, file = 'page.tsx') => {
  const full = path.join(app, relative, file)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, 'export default () => null')
}

beforeEach(() => {
  app = fs.mkdtempSync(path.join(os.tmpdir(), 'routes-'))
})
afterEach(() => fs.rmSync(app, { recursive: true, force: true }))

describe('discoverRoutes', () => {
  it('finds each page as its URL, sorted: the root, nested folders, and route groups left out', () => {
    page('')
    page('about')
    page('(site)/work')
    page('(site)/(deep)/work/archive')
    page('examples/glow', 'page.ts')
    expect(discoverRoutes(app)).toEqual({
      static: ['/', '/about', '/examples/glow', '/work', '/work/archive'],
      dynamic: [],
    })
  })

  it('lists a dynamic page by its pattern instead of sweeping it, catch-alls included', () => {
    page('work/[slug]')
    page('docs/[...path]')
    page('shop/[[...filters]]')
    page('about')
    expect(discoverRoutes(app)).toEqual({
      static: ['/about'],
      dynamic: ['/docs/[...path]', '/shop/[[...filters]]', '/work/[slug]'],
    })
  })

  it('ignores what is not a page: route handlers, layouts, parallel slots and private folders', () => {
    page('internal/health', 'route.ts')
    page('about', 'layout.tsx')
    page('@modal/photo')
    page('_components/card')
    page('about')
    expect(discoverRoutes(app).static).toEqual(['/about'])
  })

  it('leaves out intercepting routes, which show another URL in place and are no page of their own', () => {
    page('feed/photo/[id]')
    page('feed/(.)photo/[id]')
    page('feed/(..)photo/[id]')
    page('feed/(..)(..)photo')
    page('feed/(...)photo')
    page('feed/(.)gallery', 'default.tsx')
    expect(discoverRoutes(app)).toEqual({ static: [], dynamic: ['/feed/photo/[id]'] })
  })

  it('still takes a route group for no segment, and a folder that only starts like one for a segment', () => {
    page('(site)/work')
    page('(a)b/c')
    expect(discoverRoutes(app).static).toEqual(['/(a)b/c', '/work'])
  })

  it('finds nothing in a folder that is missing, so the caller can fail instead of sweeping nothing', () => {
    expect(discoverRoutes(path.join(app, 'nope'))).toEqual({ static: [], dynamic: [] })
  })
})

describe('publicRoutes', () => {
  it('is every static page plus a sample URL for each dynamic one', () => {
    page('')
    page('work/[slug]')
    expect(publicRoutes(app, { '/work/[slug]': '/work/first' })).toEqual(['/', '/work/first'])
  })

  it('refuses a dynamic page that has no sample, naming it', () => {
    page('work/[slug]')
    expect(() => publicRoutes(app, {})).toThrow('/work/[slug]')
  })

  it('refuses a sample for a page that does not exist any more', () => {
    page('')
    expect(() => publicRoutes(app, { '/gone/[id]': '/gone/1' })).toThrow('/gone/[id]')
  })
})

describe("this repo's web app", () => {
  it('has pages, and a sample for every dynamic one', () => {
    const routes = publicRoutes()
    expect(routes).toContain('/')
    expect(APP_DIR.endsWith(path.join('apps', 'web', 'src', 'app'))).toBe(true)
  })
})
