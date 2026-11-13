// The WebGL DOM-fallback check: a page with an effect must still be complete when the effect
// cannot run (the engine contract, packages/motion/README.md: "ok: false and plain HTML"). The
// headless runner's WebGL varies, so the check does not wait for a GPU: it takes WebGL2 away, or
// makes every shader fail to compile, and looks at what is left on the page.
//
// Adapted from darkroom.engineering's Satus (lib/hooks/use-device-detection.ts and
// lib/webgl/README.md, MIT; see THIRD-PARTY-NOTICES.md): every WebGL surface has a DOM fallback
// for software renderers and devices without WebGL, and nothing may depend on the canvas.
import { expect, type BrowserContext, type Page } from '@playwright/test'

import { MOTION_FAULT_EVENT } from '../packages/motion/src/fault.ts'

/** A page with an effect, and what it must still show with the effect off. */
export type EffectPage = {
  route: string
  /** Whole-element texts that must be visible and opaque with no WebGL. */
  text: string[]
  /** The effect's canvas: gone once the effect has failed to start. */
  canvas: string
}

/** The example effect's page. A project lists the pages of its own effects here. */
export const EFFECT_PAGES: EffectPage[] = [
  {
    route: '/examples/glow',
    text: ['Glow example', 'Plain HTML, in front of the canvas.'],
    canvas: 'canvas[data-perf="glow"]',
  },
]

export type Fault = { kind: string; detail: string }

/** For the pages of this context from now on: record every motion fault in `window.__faults`. */
export async function recordFaults(context: BrowserContext): Promise<void> {
  await context.addInitScript((event: string) => {
    const faults: unknown[] = []
    ;(window as unknown as { __faults: unknown[] }).__faults = faults
    window.addEventListener(event, (e) => faults.push((e as CustomEvent).detail))
  }, MOTION_FAULT_EVENT)
}

export const faultsOf = (page: Page): Promise<Fault[]> =>
  page.evaluate(() => (window as unknown as { __faults?: Fault[] }).__faults ?? [])

/** How many times the page asked for a WebGL context that `withoutWebGL` / `withBrokenShaders` refused. */
export const glRequestsOf = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __glRequests?: number }).__glRequests ?? 0)

/**
 * Waits until the page's effect has asked for a WebGL context and been refused: the outcome that
 * says its mount code has run (after hydration), so what is checked next is what is left, not what
 * the server rendered. Retries until the expect timeout, then fails naming what it waited for.
 */
export async function effectTried(page: Page, timeout?: number): Promise<void> {
  await expect
    .poll(() => glRequestsOf(page), {
      message: 'the effect never asked for a WebGL context',
      ...(timeout === undefined ? {} : { timeout }),
    })
    .toBeGreaterThan(0)
}

/** A browser with no WebGL: `getContext('webgl2' | 'webgl')` answers null, as it does on an old device. */
export async function withoutWebGL(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...rest: unknown[]
    ) {
      if (/^(experimental-)?webgl2?$/.test(type)) {
        const counter = window as unknown as { __glRequests?: number }
        counter.__glRequests = (counter.__glRequests ?? 0) + 1
        return null
      }
      return (original as (...args: unknown[]) => unknown).call(this, type, ...rest)
    } as typeof original
  })
}

/**
 * A browser whose WebGL2 context exists but compiles no shader and links no program, as a driver
 * bug or an unsupported GLSL feature would.
 */
export async function withBrokenShaders(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    const fake = new Proxy(
      {},
      {
        get(_target, name) {
          if (typeof name !== 'string') return undefined
          // Constants (gl.VERTEX_SHADER, ...) are numbers; a status query says "no"; the rest do nothing.
          if (/^[A-Z][A-Z0-9_]*$/.test(name)) return 1
          if (name === 'createShader' || name === 'createProgram') return () => ({})
          if (name === 'getShaderParameter' || name === 'getProgramParameter') return () => false
          return () => null
        },
      },
    )
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...rest: unknown[]
    ) {
      if (type === 'webgl2') {
        const counter = window as unknown as { __glRequests?: number }
        counter.__glRequests = (counter.__glRequests ?? 0) + 1
        return fake
      }
      return (original as (...args: unknown[]) => unknown).call(this, type, ...rest)
    } as typeof original
  })
}

/** What is wrong with the effect page now open, read once; empty is fine. */
async function problemsNow(page: Page, effect: EffectPage): Promise<string[]> {
  const problems: string[] = []
  for (const text of effect.text) {
    const element = page.getByText(text, { exact: true }).first()
    if (!(await element.isVisible())) {
      problems.push(`"${text}" is not visible without WebGL`)
    } else if (
      await element.evaluate((node) => {
        for (let at: Element | null = node; at; at = at.parentElement) {
          if (getComputedStyle(at).opacity === '0') return true
        }
        return false
      })
    ) {
      problems.push(`"${text}" is there but transparent without WebGL`)
    }
  }
  const canvases = await page.locator(effect.canvas).count()
  if (canvases > 0)
    problems.push(`${canvases} effect canvas left on the page after the effect failed`)
  return problems
}

/**
 * What is wrong with the effect page now open when its effect is not running; empty is fine. It
 * retries until the page has no problem or `timeout` runs out (a canvas is removed, a fade ends),
 * then reports what was last seen, so a broken page costs the timeout and a good one nothing. Call
 * `effectTried` first: before the effect's mount code has run, the server's HTML is all there is.
 */
export async function domFallbackProblems(
  page: Page,
  effect: EffectPage,
  timeout = 5_000,
): Promise<string[]> {
  let problems = ['the effect page could not be read']
  await expect
    .poll(async () => (problems = await problemsNow(page, effect)), { timeout })
    .toEqual([])
    .catch(() => undefined)
  return problems
}
