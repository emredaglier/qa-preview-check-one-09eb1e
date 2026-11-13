import { setHtmlFlag } from './html-state'

const RESET_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'scroll'] as const
/** Input fires constantly; resetting the timer 4 times a second is plenty. */
const THROTTLE_MS = 250

/**
 * Seconds with no input before the site goes idle: a default and, per route, an override. The
 * starter has no route-specific timeout; a project sets its own with `configureIdle`.
 */
export type IdleSettings = {
  defaultSeconds: number
  /** Exact pathname to seconds, e.g. `{ '/': 60 }`. */
  routes: Readonly<Record<string, number>>
}

export const DEFAULT_IDLE_SETTINGS: IdleSettings = { defaultSeconds: 180, routes: {} }

let settings: IdleSettings = DEFAULT_IDLE_SETTINGS

/** Sets the idle timeouts. Anything left out keeps its default. */
export const configureIdle = (next: Partial<IdleSettings>): void => {
  settings = { ...DEFAULT_IDLE_SETTINGS, ...next }
}

/** Back to the defaults (a test helper). */
export const resetIdleSettings = (): void => {
  settings = DEFAULT_IDLE_SETTINGS
}

const positive = (seconds: unknown): seconds is number =>
  typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0

/**
 * The idle timeout for a pathname, from the settings. Test hook: a positive number in
 * `window.__HOUSE_IDLE_MS__` (set by an e2e test before load) overrides every route.
 */
export const idleTimeoutMs = (pathname: string): number => {
  const hook = (globalThis as { __HOUSE_IDLE_MS__?: unknown }).__HOUSE_IDLE_MS__
  if (positive(hook)) return hook
  const route = Object.hasOwn(settings.routes, pathname) ? settings.routes[pathname] : undefined
  const seconds = positive(route) ? route : settings.defaultSeconds
  return (positive(seconds) ? seconds : DEFAULT_IDLE_SETTINGS.defaultSeconds) * 1000
}

export type IdleOptions = {
  /** Read each time the timer is armed, so it can follow the current route. */
  timeoutMs: () => number
}

export type IdleWatcher = {
  /** Calls `fn(idle)` now and on every change. Returns an unsubscribe function. */
  watch: (fn: (idle: boolean) => void) => () => void
  /** Removes the listeners and the timer and clears `data-saver`. */
  dispose: () => void
}

const hasMouse = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches

/**
 * Idle detection for mouse devices only. Without a fine pointer, subscribers get `false` once and
 * the site never goes idle. Toggles `html[data-saver]` and notifies subscribers.
 */
export const createIdleWatcher = ({ timeoutMs }: IdleOptions): IdleWatcher => {
  const subscribers = new Set<(idle: boolean) => void>()
  let idle = false
  let last = -Infinity
  let timer: ReturnType<typeof setTimeout> | undefined
  let started = false

  const set = (value: boolean) => {
    if (value === idle) return
    idle = value
    setHtmlFlag('saver', value)
    subscribers.forEach((fn) => fn(value))
  }

  const poke = () => {
    const now = performance.now()
    if (!idle && now - last < THROTTLE_MS) return
    last = now
    if (idle) set(false)
    clearTimeout(timer)
    timer = setTimeout(() => set(true), timeoutMs())
  }

  const start = () => {
    started = true
    for (const type of RESET_EVENTS) {
      window.addEventListener(type, poke, { capture: true, passive: true })
    }
    poke()
  }

  return {
    watch(fn) {
      if (!hasMouse()) {
        fn(false)
        return () => {}
      }
      if (!started) start()
      subscribers.add(fn)
      fn(idle)
      return () => {
        subscribers.delete(fn)
      }
    },
    dispose() {
      for (const type of RESET_EVENTS) {
        window.removeEventListener(type, poke, { capture: true })
      }
      clearTimeout(timer)
      subscribers.clear()
      started = false
      idle = false
      document.documentElement.removeAttribute('data-saver')
    },
  }
}
