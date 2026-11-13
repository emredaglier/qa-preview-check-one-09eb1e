// Secrets in the bundle: nothing the browser is served may hold a server secret. smoke/run.ts gives
// the containers throwaway secrets and passes their values here (SMOKE_SECRETS); this reads every
// page, its flight data (a server value handed to a client component lands there), every script and
// stylesheet reachable from them and every one the image holds (smoke/run.ts lists them, because a
// lazily loaded chunk has no link in any page), and fails on a secret's value or on text shaped like a
// credential. The crawl is smoke/secrets-scan.ts `collectServed`, with its own unit tests.
//
// Adapted from darkroom.engineering's Satus (e2e/secrets-in-bundle.e2e.ts, MIT; see
// THIRD-PARTY-NOTICES.md).
import fs from 'node:fs'

import { UNKNOWN_PATH } from './fixture-data.ts'
import { expect, test } from './fixtures.ts'
import { publicRoutes } from './routes.ts'
import { collectServed, findLeaks } from './secrets-scan.ts'

const secrets: string[] = JSON.parse(process.env.SMOKE_SECRETS ?? '[]')
/** smoke/run.ts lists the image's scripts and stylesheets: lazily loaded chunks have no link in a page. */
const builtFiles: string[] = process.env.SMOKE_BUILT_FILES
  ? JSON.parse(fs.readFileSync(process.env.SMOKE_BUILT_FILES, 'utf8'))
  : []

test('no server secret reaches anything the browser is served', async ({ request }) => {
  expect(
    secrets.length,
    'smoke/run.ts passes the container secrets as SMOKE_SECRETS',
  ).toBeGreaterThan(0)
  expect(
    builtFiles.length,
    'smoke/run.ts lists the image scripts and stylesheets as SMOKE_BUILT_FILES',
  ).toBeGreaterThan(0)

  // A page may answer its own non-200 (the 404 page): it is still served to the browser.
  const { files, unserved } = await collectServed(
    async (url, headers) => {
      const response = await request.get(url, { headers, maxRedirects: 0 })
      return { status: response.status(), text: await response.text() }
    },
    [...publicRoutes(), UNKNOWN_PATH],
    builtFiles,
  )
  expect(unserved, 'built files the container did not serve, so were not scanned').toEqual([])
  // The scan must have read build output, or "no leaks" says nothing.
  expect(files.filter((file) => file.url.endsWith('.js')).length).toBeGreaterThan(0)

  await test.info().attach('secrets-scan', {
    body: JSON.stringify(
      { files: files.map((file) => file.url), secretCount: secrets.length },
      null,
      2,
    ),
    contentType: 'application/json',
  })
  expect(findLeaks(files, secrets)).toEqual([])
})
