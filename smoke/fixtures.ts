// The Playwright `test` every smoke spec uses: requests are held to the container and the asset
// prefix, and `visit` opens a path and reports what went wrong on it.
import { expect, test as base } from '@playwright/test'

import {
  consoleFailure,
  pageErrorFailure,
  requestFailure,
  responseFailure,
  type Expectation,
} from './failure-rules.ts'
import { loadEverything } from './load-everything.ts'
import { routeAssets } from './network.ts'

export { expect }

const url = process.env.SMOKE_BASE_URL
const secret = process.env.SMOKE_REVALIDATE_SECRET
if (!url || !secret) {
  throw new Error('Run through `pnpm smoke` (SMOKE_BASE_URL unset).')
}
export const baseUrl: string = url
export const revalidateSecret: string = secret

export type Visit = (path: string, status?: number) => Promise<string[]>

export const test = base.extend<{ visit: Visit }>({
  // Requests may only go to the container and the (rewritten) asset prefix. Anything else is a
  // failure, so a stray external request cannot hide in CI.
  context: async ({ context }, provide) => {
    await routeAssets(context)
    await provide(context)
  },

  /** Opens a path and returns what went wrong on it: console errors, page errors, failed or 4xx requests. */
  visit: async ({ page }, provide) => {
    await provide(async (path, status = 200) => {
      const failures: string[] = []
      const expected: Expectation = { url: new URL(path, baseUrl).toString(), status }
      page.on('console', (message) => {
        const failure = consoleFailure(
          { type: message.type(), text: message.text(), location: message.location().url },
          expected,
        )
        if (failure) failures.push(failure)
      })
      page.on('pageerror', (error) => failures.push(pageErrorFailure(error)))
      page.on('requestfailed', (request) => {
        const failure = requestFailure({
          url: request.url(),
          reason: request.failure()?.errorText,
          jsEnabled: true,
        })
        if (failure) failures.push(failure)
      })
      page.on('response', (response) => {
        const request = response.request()
        const failure = responseFailure(
          {
            url: response.url(),
            status: response.status(),
            isDocument: request.isNavigationRequest() && request.frame() === page.mainFrame(),
          },
          expected,
        )
        if (failure) failures.push(failure)
      })

      const response = await page.goto(path, { waitUntil: 'load' })
      expect(response?.status(), `status of ${path}`).toBe(status)
      await loadEverything(page)
      return failures
    })
  },
})
