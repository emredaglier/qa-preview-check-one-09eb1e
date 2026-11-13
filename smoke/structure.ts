// The page structure every public page needs, asserted in one place for both the route sweep
// (smoke/sweep.ts) and the accessibility spec (smoke/a11y.ts): a language, a title, one main
// landmark and one visible h1, the h1 counted anywhere in the document. Proven against a broken
// page by smoke/checks.selftest.spec.ts.
import type { Page } from '@playwright/test'

/** What the page itself must have, read in the browser. */
export type Structure = {
  lang: string
  title: string
  mains: number
  h1s: number
  /** Whether the only h1 takes up room and is not `visibility: hidden`; true when there is not exactly one. */
  h1Visible: boolean
}

/** The structure problems of a page, as sentences. Pure, so it is unit-tested. */
export function structureProblems({ lang, title, mains, h1s, h1Visible }: Structure): string[] {
  const problems: string[] = []
  if (!lang.trim()) problems.push('<html> has no lang')
  if (!title.trim()) problems.push('the page has no <title>')
  if (mains !== 1) problems.push(`${mains} <main> landmarks, want 1`)
  if (h1s !== 1) problems.push(`${h1s} <h1> headings, want 1`)
  else if (!h1Visible) problems.push('the <h1> is not visible')
  return problems
}

/** Reads the structure of the page now open, and returns its problems; empty is fine. */
export async function pageStructureProblems(page: Page): Promise<string[]> {
  const structure = await page.evaluate((): Structure => {
    const h1s = document.querySelectorAll('h1')
    const only = h1s.length === 1 ? h1s[0] : undefined
    const box = only?.getBoundingClientRect()
    return {
      lang: document.documentElement.lang,
      title: document.title,
      mains: document.querySelectorAll('main, [role="main"]').length,
      h1s: h1s.length,
      h1Visible:
        !only ||
        (!!box &&
          box.width > 0 &&
          box.height > 0 &&
          getComputedStyle(only).visibility !== 'hidden'),
    }
  })
  return structureProblems(structure)
}
