import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, devices } from '@playwright/test'

/**
 * Smoke gate (ADR-0005). `pnpm smoke` (smoke/run.ts) builds the web image, starts the container
 * on a migrated and seeded temp database, then runs this with SMOKE_BASE_URL /
 * SMOKE_ASSET_PREFIX / SMOKE_REVALIDATE_SECRET set. Headless, so it runs the same in CI.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const out = process.env.SMOKE_OUTPUT_DIR ?? path.join(here, '.output')

export default defineConfig({
  testDir: here,
  testMatch: '*.spec.ts',
  outputDir: path.join(out, 'results'),
  reporter: [['list'], ['html', { open: 'never', outputFolder: path.join(out, 'report') }]],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.SMOKE_BASE_URL,
    // Kept on failure only: traces and screenshots land in <out>/results.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } }],
})
