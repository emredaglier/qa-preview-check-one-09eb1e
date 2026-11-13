import { gsap } from 'gsap'
import { reportMotionFault } from './fault'

/** `(time in seconds, deltaTime in ms, frame)`, GSAP's ticker signature. */
export type Tick = (time: number, deltaTime: number, frame: number) => void

const MAX_FAILURES = 5
/** Slack so a 60 Hz screen's slightly early frames are not dropped. */
const CAP_SLACK = 0.003

/** The callback the `__HOUSE_TICK_FAULT__` test hook picked to fail (the first one to run). */
let faulted: Tick | null = null

const wrapped = new WeakMap<Tick, Tick>()
const failures = new WeakMap<Tick, number>()

/**
 * Test hook for the fallback matrix: `window.__HOUSE_TICK_FAULT__ = true` (set by an
 * e2e test) makes the first callback that runs throw every frame, so the logging, the removal
 * after 5 failures and the other loops carrying on can be observed. Off otherwise.
 */
const faultHook = (): boolean =>
  typeof window !== 'undefined' &&
  (window as { __HOUSE_TICK_FAULT__?: unknown }).__HOUSE_TICK_FAULT__ === true

/**
 * `gsap.ticker.add`, but a callback that throws cannot take the others down with it. The first
 * throw is logged with its error; the callback is removed after 5 failures in a row. Callbacks do
 * not run while the tab is hidden.
 */
export const addTick = (fn: Tick): void => {
  if (wrapped.has(fn)) return
  const name = fn.name || 'anonymous'
  const safe: Tick = (time, deltaTime, frame) => {
    if (typeof document !== 'undefined' && document.hidden) return
    try {
      if (faultHook() && (faulted === null || faulted === fn)) {
        faulted = fn
        throw new Error('injected by __HOUSE_TICK_FAULT__')
      }
      fn(time, deltaTime, frame)
      failures.set(fn, 0)
    } catch (error) {
      const count = (failures.get(fn) ?? 0) + 1
      failures.set(fn, count)
      if (count === 1) console.error(`[ticker] "${name}" threw:`, error)
      if (count >= MAX_FAILURES) {
        console.error(`[ticker] "${name}" removed after ${MAX_FAILURES} failures in a row`)
        reportMotionFault('ticker-callback-removed', name)
        removeTick(fn)
      }
    }
  }
  wrapped.set(fn, safe)
  gsap.ticker.add(safe)
}

export const removeTick = (fn: Tick): void => {
  const safe = wrapped.get(fn)
  if (!safe) return
  gsap.ticker.remove(safe)
  wrapped.delete(fn)
}

/**
 * Wraps a tick so it runs at most about `hz` times a second (default 60), skipping a frame when
 * less than `1/hz - 3 ms` has passed since the last one it ran. For decorative loops on 120 Hz screens.
 */
export const cappedTick = (fn: Tick, hz = 60): Tick => {
  const minStep = 1 / hz - CAP_SLACK
  let last = -Infinity
  return (time, deltaTime, frame) => {
    if (time - last < minStep) return
    last = time
    fn(time, deltaTime, frame)
  }
}
