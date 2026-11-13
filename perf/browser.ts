// Shared Playwright helpers for frames.ts and idle.ts.
import type { BrowserContext, Page } from '@playwright/test'

/**
 * Runs before any page script. Counts every requestAnimationFrame callback the site schedules
 * (the idle check reads it), and offers a frame recorder the scenarios start and stop.
 */
const INIT_SCRIPT = `
(() => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__rafCalls = 0;
  window.requestAnimationFrame = (cb) => raf((t) => { window.__rafCalls++; cb(t); });
  window.__frames = { stamps: [], on: false };
  const tick = (t) => {
    if (!window.__frames.on) return;
    window.__frames.stamps.push(t);
    raf(tick);
  };
  window.__startFrames = () => { window.__frames.stamps = []; window.__frames.on = true; raf(tick); };
  window.__stopFrames = () => { window.__frames.on = false; return window.__frames.stamps; };
})();
`

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function newInstrumentedPage(context: BrowserContext): Promise<Page> {
  await context.addInitScript(INIT_SCRIPT)
  return context.newPage()
}

export const startFrames = (page: Page) => page.evaluate('window.__startFrames()')
export const stopFrames = (page: Page) => page.evaluate<number[]>('window.__stopFrames()')
export const rafCalls = (page: Page) => page.evaluate<number>('window.__rafCalls')
