import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'

const data = vi.hoisted(() => ({ site: {} as Record<string, unknown> }))
vi.mock('../data/site', () => ({ getSite: async () => data.site }))

import Home from './page'

beforeEach(() => {
  data.site = { name: 'Test name', tagline: 'A tagline.', intro: 'An intro paragraph.' }
})

it('renders the Site global as plain server HTML, so it needs no JavaScript', async () => {
  const html = renderToStaticMarkup(await Home())
  expect(html).toContain('<h1')
  expect(html).toContain('Test name')
  expect(html).toContain('A tagline.')
  expect(html).toContain('An intro paragraph.')
})

it('still renders on an unseeded database', async () => {
  data.site = {}
  expect(renderToStaticMarkup(await Home())).toContain('<main')
})
