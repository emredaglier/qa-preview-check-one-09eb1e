// Accessibility assertions on every public route and on the 404 page (smoke/a11y.ts). Look, motion
// and interaction are not asserted here (CODING_STANDARDS.md); this is structure and axe's critical
// and serious findings.
import { a11yProblems } from './a11y.ts'
import { UNKNOWN_PATH } from './fixture-data.ts'
import { expect, test } from './fixtures.ts'
import { publicRoutes } from './routes.ts'

test.describe('accessibility', () => {
  for (const route of publicRoutes()) {
    test(`${route} has no critical or serious accessibility problem`, async ({ page, visit }) => {
      await visit(route)
      expect(await a11yProblems(page)).toEqual([])
    })
  }

  test('the 404 page has no critical or serious accessibility problem', async ({ page, visit }) => {
    await visit(UNKNOWN_PATH, 404)
    expect(await a11yProblems(page)).toEqual([])
  })
})
