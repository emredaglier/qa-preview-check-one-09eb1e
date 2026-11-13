// Frame-time scenarios: Chromium at 4x CPU throttle, and WebKit. Headless browsers
// have no GPU, so the numbers are only meaningful relative to an earlier run on the same machine.
import { chromium, webkit, type Page } from '@playwright/test'

import { newInstrumentedPage, sleep, startFrames, stopFrames } from './browser.ts'
import type { FrameResult } from './budget.ts'
import { SCENARIOS, skipReason, type Scenario, type Step } from './scenarios.ts'
import { framesFromTimestamps, summarizeFrames } from './stats.ts'

async function box(page: Page, selector: string) {
  const b = await page.locator(selector).first().boundingBox()
  if (!b) throw new Error(`no box for ${selector}`)
  return b
}

async function runStep(page: Page, step: Step) {
  switch (step.do) {
    case 'wait':
      return sleep(step.ms)
    case 'click':
      return page.locator(step.selector).first().click()
    case 'scroll': {
      const { width, height } = page.viewportSize()!
      await page.mouse.move(width / 2, height / 2)
      for (let i = 0; i < step.steps; i++) {
        await page.mouse.wheel(0, step.total / step.steps)
        await sleep(step.intervalMs)
      }
      return
    }
    case 'drag': {
      const b = await box(page, step.selector)
      const y = b.y + b.height / 2
      const x = b.x + b.width / 2
      await page.mouse.move(x, y)
      await page.mouse.down()
      for (let i = 1; i <= step.steps; i++) {
        await page.mouse.move(x + (step.dx * i) / step.steps, y)
        await sleep(step.intervalMs)
      }
      return page.mouse.up()
    }
    case 'sweep': {
      const b = await box(page, step.selector)
      const y = b.y + b.height / 2
      for (let i = 0; i <= step.steps; i++) {
        await page.mouse.move(b.x + (b.width * i) / step.steps, y)
        await sleep(step.intervalMs)
      }
      return
    }
  }
}

async function runScenario(page: Page, baseUrl: string, scenario: Scenario): Promise<FrameResult> {
  await page.goto(baseUrl + scenario.path, { waitUntil: 'load' })
  await sleep(500)
  const reason = skipReason(scenario, await page.locator(scenario.requires).count())
  if (reason) {
    console.log(`[perf] skipped: ${reason}`)
    return { status: 'skipped', reason }
  }
  await startFrames(page)
  for (const step of scenario.steps) await runStep(page, step)
  const stamps = await stopFrames(page)
  return { status: 'ok', ...summarizeFrames(framesFromTimestamps(stamps)) }
}

const PROJECTS = [
  { name: 'chromium-4x', launcher: chromium, throttle: 4 },
  { name: 'webkit', launcher: webkit, throttle: 1 },
] as const

/** Every scenario in every project, keyed `<project>/<scenario id>`. */
export async function runFrames(baseUrl: string) {
  const results: Record<string, FrameResult> = {}
  for (const project of PROJECTS) {
    const browser = await project.launcher.launch()
    try {
      for (const scenario of SCENARIOS) {
        // A fresh context per scenario so one run's state cannot warm the next.
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
        try {
          const page = await newInstrumentedPage(context)
          if (project.throttle > 1) {
            const cdp = await context.newCDPSession(page)
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: project.throttle })
          }
          const key = `${project.name}/${scenario.id}`
          const result = await runScenario(page, baseUrl, scenario)
          results[key] = result
          if (result.status === 'ok') console.log(`[perf] ${key}`, result)
        } finally {
          await context.close()
        }
      }
    } finally {
      await browser.close()
    }
  }
  return results
}
