// @vitest-environment jsdom
import { gsap } from 'gsap'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MOTION_FAULT_EVENT } from '../fault'
import { mountGlow } from './mount'

/** A WebGL2 stand-in; `draws()` counts the full-screen draws. */
const fakeGl = () => {
  const calls: string[] = []
  const gl = new Proxy(
    {},
    {
      get: (_target, name: string) => {
        if (name === 'getShaderParameter' || name === 'getProgramParameter') return () => true
        if (/^[A-Z0-9_]+$/.test(name)) return 1
        return () => {
          calls.push(name)
          return {}
        }
      },
    },
  )
  return { gl, draws: () => calls.filter((name) => name === 'drawArrays').length }
}

/** Every canvas gets this GL (or none when `gl` is null) and a 400 x 200 layout box. */
const withGl = (gl: unknown) => {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(400)
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(200)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 400,
    height: 200,
  } as DOMRect)
  return vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => gl) as never)
}

const hostWithText = () => {
  const host = document.createElement('div')
  host.innerHTML = '<h2>Plain HTML</h2>'
  document.body.append(host)
  return host
}

/** The callbacks on the ticker, driven by hand: frames are exactly 20 ms apart. */
type TickFn = (time: number, deltaTime: number, frame: number) => void
const loop = new Set<TickFn>()
let clock = 0
const frame = (times = 1) => {
  for (let i = 0; i < times; i++) {
    clock += 0.02
    for (const fn of [...loop]) fn(clock, 20, i)
  }
}

beforeEach(() => {
  loop.clear()
  clock = 0
  vi.spyOn(gsap.ticker, 'add').mockImplementation(((fn: TickFn) => {
    loop.add(fn)
    return fn
  }) as never)
  vi.spyOn(gsap.ticker, 'remove').mockImplementation(((fn: TickFn) => {
    loop.delete(fn)
    return gsap.ticker
  }) as never)
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('mountGlow: engine contract', () => {
  it('without WebGL2: ok is false, the host keeps its plain HTML untouched, nothing throws', () => {
    withGl(null)
    const host = hostWithText()
    const before = host.innerHTML
    const glow = mountGlow(host)
    expect(glow.ok).toBe(false)
    expect(host.innerHTML).toBe(before)
    expect(() => {
      glow.setActive(false)
      glow.setColor()
      glow.dispose()
    }).not.toThrow()
  })

  it('with WebGL2: puts one decorative canvas in front of the host content', () => {
    withGl(fakeGl().gl)
    const host = hostWithText()
    const glow = mountGlow(host, { canvasAttributes: { 'data-perf': 'glow' } })
    expect(glow.ok).toBe(true)
    const canvases = host.querySelectorAll('canvas')
    expect(canvases).toHaveLength(1)
    expect(host.firstElementChild).toBe(canvases[0])
    expect(canvases[0]?.getAttribute('aria-hidden')).toBe('true')
    expect(canvases[0]?.getAttribute('data-perf')).toBe('glow')
    expect(host.querySelector('h2')?.textContent).toBe('Plain HTML')
    glow.dispose()
  })

  it('a fresh canvas for every run: dispose removes it, a second mount makes a new one (Strict Mode)', () => {
    withGl(fakeGl().gl)
    const host = hostWithText()
    const first = mountGlow(host)
    const firstCanvas = host.querySelector('canvas')
    first.dispose()
    expect(host.querySelector('canvas')).toBeNull()
    const second = mountGlow(host)
    const secondCanvas = host.querySelector('canvas')
    expect(secondCanvas).not.toBeNull()
    expect(secondCanvas).not.toBe(firstCanvas)
    expect(host.querySelectorAll('canvas')).toHaveLength(1)
    second.dispose()
    expect(host.querySelectorAll('canvas')).toHaveLength(0)
  })

  it('dispose twice is safe, and the loop is gone afterwards', () => {
    const { gl, draws } = fakeGl()
    withGl(gl)
    const glow = mountGlow(hostWithText())
    glow.dispose()
    const before = draws()
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 50 }))
    frame(5)
    expect(draws()).toBe(before)
    expect(() => glow.dispose()).not.toThrow()
  })

  it('a lost context removes nothing from the page and is reported once', () => {
    withGl(fakeGl().gl)
    const host = hostWithText()
    const glow = mountGlow(host)
    const faults: unknown[] = []
    const listen = (event: Event) => faults.push((event as CustomEvent).detail)
    window.addEventListener(MOTION_FAULT_EVENT, listen)
    host.querySelector('canvas')?.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    window.removeEventListener(MOTION_FAULT_EVENT, listen)
    expect(faults).toEqual([{ kind: 'gl-context-lost', detail: 'glow' }])
    expect(glow.ok).toBe(false)
    expect(host.querySelector('h2')).not.toBeNull()
    glow.dispose()
  })
})

describe('mountGlow: motion', () => {
  it('draws while the pointer moves and stops drawing once the glow has caught up', () => {
    const { gl, draws } = fakeGl()
    withGl(gl)
    const glow = mountGlow(hostWithText())
    const start = draws()
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 10 }))
    frame(5)
    expect(draws()).toBeGreaterThan(start)
    // Nothing left to move: the loop idles without touching the GPU.
    frame(1200)
    const settled = draws()
    frame(60)
    expect(draws()).toBe(settled)
    glow.dispose()
  })

  it('does not run its loop while inactive (idle visitor), and resumes when active again', () => {
    const { gl, draws } = fakeGl()
    withGl(gl)
    const glow = mountGlow(hostWithText())
    glow.setActive(false)
    const before = draws()
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 10 }))
    frame(5)
    expect(draws()).toBe(before)
    glow.setActive(true)
    frame(5)
    expect(draws()).toBeGreaterThan(before)
    glow.dispose()
  })

  it('with reduced motion: one still frame, no loop, no pointer following', () => {
    const { gl, draws } = fakeGl()
    withGl(gl)
    const glow = mountGlow(hostWithText(), { reducedMotion: true })
    expect(glow.ok).toBe(true)
    const still = draws()
    expect(still).toBeGreaterThan(0)
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 10 }))
    frame(10)
    expect(draws()).toBe(still)
    glow.dispose()
  })
})
