// What the route sweep asserts of one route: it loads (status 200, no console error, page error,
// failed request or 4xx subresource: `visit`) and has the page structure of smoke/structure.ts
// (language, title, one main, one visible h1).
// Proven against a broken page by smoke/checks.selftest.spec.ts.
import type { Page } from '@playwright/test'

import type { Visit } from './fixtures.ts'
import { pageStructureProblems } from './structure.ts'

export async function sweepProblems(page: Page, visit: Visit, route: string): Promise<string[]> {
  const problems = await visit(route)
  problems.push(...(await pageStructureProblems(page)))
  return problems
}
