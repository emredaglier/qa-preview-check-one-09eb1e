// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { HTML_FLAGS, HTML_VARS, hasHtmlFlag, setHtmlFlag, setHtmlVar } from './html-state'

const html = document.documentElement

describe('html state', () => {
  beforeEach(() => {
    for (const attr of [...html.attributes]) html.removeAttribute(attr.name)
    html.removeAttribute('style')
  })

  it('starts with only the flag the idle watcher sets, and no custom properties', () => {
    expect([...HTML_FLAGS]).toEqual(['saver'])
    expect([...HTML_VARS]).toEqual([])
  })

  it('toggles every flag as a data attribute', () => {
    for (const flag of HTML_FLAGS) {
      setHtmlFlag(flag, true)
      expect(html.hasAttribute(`data-${flag}`)).toBe(true)
      expect(hasHtmlFlag(flag)).toBe(true)
      setHtmlFlag(flag, false)
      expect(hasHtmlFlag(flag)).toBe(false)
    }
  })

  it('writes and clears a custom property once a project lists it', () => {
    // The list starts empty, so the typed name is `never` until a project adds one; the cast
    // stands in for that edit.
    const name = '--example' as never
    setHtmlVar(name, 42)
    expect(html.style.getPropertyValue('--example')).toBe('42')
    setHtmlVar(name, null)
    expect(html.style.getPropertyValue('--example')).toBe('')
  })
})
