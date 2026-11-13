// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  hasFinePointer,
  hasWebGL2,
  prefersReducedMotion,
  resetWebGL2Probe,
  supportsViewTransitions,
} from './capabilities'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetWebGL2Probe()
  Reflect.deleteProperty(document, 'startViewTransition')
})

describe('capabilities', () => {
  it('reads the reduced-motion and fine-pointer queries', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q === '(prefers-reduced-motion: reduce)',
    }))
    expect(prefersReducedMotion()).toBe(true)
    expect(hasFinePointer()).toBe(false)
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('pointer: fine') }))
    expect(prefersReducedMotion()).toBe(false)
    expect(hasFinePointer()).toBe(true)
  })

  it('is false without matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(prefersReducedMotion()).toBe(false)
  })

  it('detects WebGL2 and caches the probe', () => {
    const get = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(((type: string) => (type === 'webgl2' ? {} : null)) as never)
    expect(hasWebGL2()).toBe(true)
    expect(hasWebGL2()).toBe(true)
    expect(get).toHaveBeenCalledTimes(1)
    resetWebGL2Probe()
    get.mockReturnValue(null)
    expect(hasWebGL2()).toBe(false)
  })

  it('treats a throwing context as no WebGL2', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(hasWebGL2()).toBe(false)
  })

  it('detects View Transitions', () => {
    expect(supportsViewTransitions()).toBe(false)
    Object.defineProperty(document, 'startViewTransition', { value: () => {}, configurable: true })
    expect(supportsViewTransitions()).toBe(true)
  })
})
