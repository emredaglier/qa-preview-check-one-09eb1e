import { expect, type Page } from '@playwright/test'

/**
 * Scrolls every image into view (they are lazy) and waits for the network to go quiet. Only
 * locator calls here: `page.evaluate` does not run when JavaScript is disabled.
 *
 * Hydration can replace images under this loop (a server-rendered list swapped for its client
 * version), and `scrollIntoViewIfNeeded` throws, without retrying, when its element
 * goes away. So count and resolve afresh at every step, and retry a step that lost its element.
 */
export async function loadEverything(page: Page): Promise<void> {
  const images = page.locator('img')
  for (let i = 0; i < (await images.count()); i++) {
    await expect(async () => {
      const image = images.nth(i)
      if (await image.count()) await image.scrollIntoViewIfNeeded({ timeout: 10_000 })
    }).toPass({ timeout: 30_000 })
  }
  await page.waitForLoadState('networkidle')
}
