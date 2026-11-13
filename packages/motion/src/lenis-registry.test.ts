import { describe, expect, it, vi } from 'vitest'
import {
  getActiveLenis,
  registerLenis,
  startActiveLenis,
  stopActiveLenis,
  unregisterLenis,
} from './lenis-registry'

const make = () => ({ stop: vi.fn(), start: vi.fn() })

describe('lenis registry', () => {
  it('does nothing with no active instance', () => {
    expect(getActiveLenis()).toBeNull()
    expect(() => stopActiveLenis()).not.toThrow()
    expect(() => startActiveLenis()).not.toThrow()
  })

  it('stops and starts whichever instance is active', () => {
    const a = make()
    const b = make()
    registerLenis(a)
    registerLenis(b)
    stopActiveLenis()
    startActiveLenis()
    expect(a.stop).not.toHaveBeenCalled()
    expect(b.stop).toHaveBeenCalledTimes(1)
    expect(b.start).toHaveBeenCalledTimes(1)
    unregisterLenis(b)
  })

  it('ignores an unregister from a replaced instance', () => {
    const a = make()
    const b = make()
    registerLenis(a)
    registerLenis(b)
    unregisterLenis(a)
    expect(getActiveLenis()).toBe(b)
    unregisterLenis(b)
    expect(getActiveLenis()).toBeNull()
  })
})
