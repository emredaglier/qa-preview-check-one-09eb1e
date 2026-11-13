// The accessibility assertions: axe-core's critical and serious findings, plus the page structure
// every page needs (a language, a title, one main landmark, one h1). Used by smoke/a11y.spec.ts on
// every route, and proven against a broken page by smoke/checks.selftest.spec.ts.
//
// Adapted from darkroom.engineering's Satus (e2e/route-sweep.e2e.ts, MIT; see
// THIRD-PARTY-NOTICES.md): it runs axe on each route and keeps critical and serious findings only,
// so minor third-party findings do not churn the baseline.
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'

import { pageStructureProblems } from './structure.ts'

/** Critical and serious axe violations and structure problems of the page now open; empty is clean. */
export async function a11yProblems(page: Page): Promise<string[]> {
  // Fonts change layout, so they change what axe measures for contrast.
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  const results = await new AxeBuilder({ page }).analyze()
  const problems = results.violations
    .filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
    .map(
      (violation) =>
        `axe ${violation.id} (${violation.impact}): ${violation.help} [${violation.nodes
          .map((node) => node.target.join(' '))
          .join(' | ')}]`,
    )
  return [...problems, ...(await pageStructureProblems(page))]
}
