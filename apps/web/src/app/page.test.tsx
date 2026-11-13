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

it('writes the hours, address, email link and footer note in the page, headings in order', async () => {
  const html = renderToStaticMarkup(await Home())
  expect(html).toContain('Monday to Saturday')
  expect(html).toContain('09:00–19:00')
  expect(html).toMatch(/Sunday<\/th><td[^>]*>Closed/)
  expect(html).toContain('Alsancak, İzmir')
  expect(html).toContain('href="mailto:hello@example.com"')
  expect(html).toMatch(/<footer[^>]*>A sample site: this shop is fictional\.<\/footer>/)
  expect(html.match(/<h[1-6]/g)).toEqual(['<h1', '<h2', '<h2'])
  expect(html.match(/<main/g)).toHaveLength(1)
})

it('has no phone number, form, map embed, image or canvas', async () => {
  const html = renderToStaticMarkup(await Home())
  for (const tag of ['<form', '<iframe', '<img', '<canvas', 'tel:']) {
    expect(html).not.toContain(tag)
  }
})

it('still renders on an unseeded database', async () => {
  data.site = {}
  expect(renderToStaticMarkup(await Home())).toContain('<main')
})
