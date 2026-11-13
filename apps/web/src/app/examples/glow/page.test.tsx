import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'

import GlowExample from './page'

it('is complete as plain server HTML, so it needs neither JavaScript nor WebGL2', () => {
  const html = renderToStaticMarkup(<GlowExample />)
  expect(html).toContain('<h1')
  expect(html).toContain('Glow example')
  expect(html).toContain('Plain HTML, in front of the canvas.')
  expect(html).not.toContain('<canvas')
})
