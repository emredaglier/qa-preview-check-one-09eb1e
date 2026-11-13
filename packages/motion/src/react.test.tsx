// @vitest-environment jsdom
import { gsap } from 'gsap'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { useIdle, useReducedMotion, useTick } from './react'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mount = (component: () => unknown) => {
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(createElement(component as () => null)))
  return { host, unmount: () => act(() => root.unmount()) }
}

const media = (matches: (query: string) => boolean) => {
  const listeners = new Set<() => void>()
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matches(query),
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }))
  return listeners
}

beforeAll(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useTick', () => {
  it('runs the callback on the ticker while mounted and stops after unmount', () => {
    const fn = vi.fn()
    const view = mount(() => {
      useTick(fn)
      return null
    })
    gsap.ticker.tick()
    gsap.ticker.tick()
    expect(fn).toHaveBeenCalledTimes(2)
    view.unmount()
    gsap.ticker.tick()
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('useReducedMotion', () => {
  it('is false on the first render, then follows the media query', () => {
    media((query) => query === '(prefers-reduced-motion: reduce)')
    const seen: boolean[] = []
    const view = mount(() => {
      seen.push(useReducedMotion())
      return null
    })
    expect(seen[0]).toBe(false)
    expect(seen.at(-1)).toBe(true)
    view.unmount()
  })
})

describe('useIdle', () => {
  it('is false without a fine pointer, so touch devices never go idle', () => {
    media(() => false)
    const seen: boolean[] = []
    const view = mount(() => {
      seen.push(useIdle())
      return null
    })
    act(() => {
      vi.advanceTimersByTime(10 * 60_000)
    })
    expect(seen.every((idle) => idle === false)).toBe(true)
    view.unmount()
  })
})
