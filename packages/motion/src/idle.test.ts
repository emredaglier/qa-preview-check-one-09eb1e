// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_IDLE_SETTINGS,
  configureIdle,
  createIdleWatcher,
  idleTimeoutMs,
  resetIdleSettings,
} from './idle'

const mouse = (matches: boolean) => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matches && query.includes('hover: hover'),
    media: query,
  }))
}

describe('idle watcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    document.documentElement.removeAttribute('data-saver')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('goes idle after the timeout, toggling data-saver', () => {
    mouse(true)
    const watcher = createIdleWatcher({ timeoutMs: () => 60_000 })
    const fn = vi.fn()
    watcher.watch(fn)
    expect(fn).toHaveBeenLastCalledWith(false)
    vi.advanceTimersByTime(59_000)
    expect(fn).toHaveBeenLastCalledWith(false)
    vi.advanceTimersByTime(1_500)
    expect(fn).toHaveBeenLastCalledWith(true)
    expect(document.documentElement.hasAttribute('data-saver')).toBe(true)
    watcher.dispose()
  })

  it('resets on input and wakes up when idle', () => {
    mouse(true)
    const watcher = createIdleWatcher({ timeoutMs: () => 10_000 })
    const fn = vi.fn()
    watcher.watch(fn)
    vi.advanceTimersByTime(9_000)
    window.dispatchEvent(new Event('pointermove'))
    vi.advanceTimersByTime(9_000)
    expect(fn).not.toHaveBeenCalledWith(true)
    vi.advanceTimersByTime(2_000)
    expect(fn).toHaveBeenLastCalledWith(true)
    window.dispatchEvent(new Event('keydown'))
    expect(fn).toHaveBeenLastCalledWith(false)
    expect(document.documentElement.hasAttribute('data-saver')).toBe(false)
    watcher.dispose()
  })

  it('throttles resets to 4 a second', () => {
    mouse(true)
    const watcher = createIdleWatcher({ timeoutMs: () => 10_000 })
    watcher.watch(() => {})
    const reset = vi.spyOn(globalThis, 'clearTimeout')
    reset.mockClear()
    for (let i = 0; i < 20; i++) window.dispatchEvent(new Event('wheel'))
    expect(reset).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    window.dispatchEvent(new Event('wheel'))
    expect(reset).toHaveBeenCalledTimes(1)
    watcher.dispose()
  })

  it('never goes idle without a fine pointer', () => {
    mouse(false)
    const watcher = createIdleWatcher({ timeoutMs: () => 1_000 })
    const fn = vi.fn()
    watcher.watch(fn)
    vi.advanceTimersByTime(10 * 60_000)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(false)
    expect(document.documentElement.hasAttribute('data-saver')).toBe(false)
    watcher.dispose()
  })

  it('unsubscribes', () => {
    mouse(true)
    const watcher = createIdleWatcher({ timeoutMs: () => 1_000 })
    const fn = vi.fn()
    const stop = watcher.watch(fn)
    stop()
    vi.advanceTimersByTime(5_000)
    expect(fn).toHaveBeenCalledTimes(1)
    watcher.dispose()
  })

  it('uses the default timeout on every route until a project configures routes', () => {
    expect(idleTimeoutMs('/')).toBe(DEFAULT_IDLE_SETTINGS.defaultSeconds * 1000)
    expect(idleTimeoutMs('/anything/else')).toBe(DEFAULT_IDLE_SETTINGS.defaultSeconds * 1000)
  })

  it('takes the route timeouts from the settings, falling back to the default', () => {
    configureIdle({ defaultSeconds: 180, routes: { '/': 60, '/gallery': 90 } })
    expect(idleTimeoutMs('/')).toBe(60_000)
    expect(idleTimeoutMs('/gallery')).toBe(90_000)
    expect(idleTimeoutMs('/about')).toBe(180_000)
    resetIdleSettings()
    expect(idleTimeoutMs('/')).toBe(DEFAULT_IDLE_SETTINGS.defaultSeconds * 1000)
  })

  it('keeps the default for a setting that is not a positive number', () => {
    configureIdle({ routes: { '/': 0, '/x': Number.NaN } })
    expect(idleTimeoutMs('/')).toBe(DEFAULT_IDLE_SETTINGS.defaultSeconds * 1000)
    expect(idleTimeoutMs('/x')).toBe(DEFAULT_IDLE_SETTINGS.defaultSeconds * 1000)
    resetIdleSettings()
  })

  it('lets a test hook shorten the timeout on every route', () => {
    configureIdle({ routes: { '/': 60 } })
    vi.stubGlobal('__HOUSE_IDLE_MS__', 1500)
    expect(idleTimeoutMs('/')).toBe(1500)
    expect(idleTimeoutMs('/other')).toBe(1500)
    vi.stubGlobal('__HOUSE_IDLE_MS__', 'nope')
    expect(idleTimeoutMs('/')).toBe(60_000)
    resetIdleSettings()
  })
})
