import { describe, expect, it } from 'vitest'

import { structureProblems, type Structure } from './structure.ts'

const good: Structure = { lang: 'en', title: 'Home', mains: 1, h1s: 1, h1Visible: true }

describe('structureProblems', () => {
  it('passes a page with a language, a title, one main and one visible h1', () => {
    expect(structureProblems(good)).toEqual([])
  })

  it('names each thing missing or doubled', () => {
    expect(structureProblems({ lang: '', title: ' ', mains: 0, h1s: 2, h1Visible: true })).toEqual([
      '<html> has no lang',
      'the page has no <title>',
      '0 <main> landmarks, want 1',
      '2 <h1> headings, want 1',
    ])
  })

  it('names an h1 nobody can see, once there is exactly one', () => {
    expect(structureProblems({ ...good, h1Visible: false })).toEqual(['the <h1> is not visible'])
  })

  it('does not call a missing h1 invisible as well', () => {
    expect(structureProblems({ ...good, h1s: 0, h1Visible: false })).toEqual([
      '0 <h1> headings, want 1',
    ])
  })
})
