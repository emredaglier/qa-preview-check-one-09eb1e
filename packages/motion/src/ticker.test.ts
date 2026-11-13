// @vitest-environment jsdom
import { gsap } from 'gsap'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { addTick, cappedTick, removeTick } from './ticker'
import { forAll } from './test-support'

const frame = (n = 1) => {
  for (let i = 0; i < n; i++) gsap.ticker.tick()
}

describe('addTick', () => {
  afterEach(() => vi.restoreAllMocks())

  it('test hook: __HOUSE_TICK_FAULT__ makes exactly one callback throw, others keep running', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const first = vi.fn()
    const second = vi.fn()
    addTick(first)
    addTick(second)
    ;(window as { __HOUSE_TICK_FAULT__?: unknown }).__HOUSE_TICK_FAULT__ = true
    frame(7)
    delete (window as { __HOUSE_TICK_FAULT__?: unknown }).__HOUSE_TICK_FAULT__
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(7)
    expect(log.mock.calls[0]?.[0]).toContain('threw')
    removeTick(second)
  })

  it('keeps later callbacks running when an earlier one throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const bad = () => {
      throw new Error('boom')
    }
    const good = vi.fn()
    addTick(bad)
    addTick(good)
    frame(2)
    expect(good).toHaveBeenCalledTimes(2)
    removeTick(bad)
    removeTick(good)
  })

  it('logs only the first failure with its error, then removes after 5 in a row', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bad = vi.fn(() => {
      throw new Error('boom')
    })
    addTick(bad)
    frame(8)
    expect(bad).toHaveBeenCalledTimes(5)
    // the first throw, then the removal notice
    expect(log).toHaveBeenCalledTimes(2)
    expect(log.mock.calls[0]?.[1]).toBeInstanceOf(Error)
  })

  it('reports the removal as a motion fault', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const faults: unknown[] = []
    const listen = (e: Event) => faults.push((e as CustomEvent).detail)
    window.addEventListener('house:motion-fault', listen)
    const broken = () => {
      throw new Error('boom')
    }
    addTick(broken)
    frame(8)
    window.removeEventListener('house:motion-fault', listen)
    expect(faults).toEqual([{ kind: 'ticker-callback-removed', detail: 'broken' }])
  })

  it('resets the failure count after a success', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let n = 0
    const flaky = vi.fn(() => {
      n++
      if (n % 3 !== 0) throw new Error('x')
    })
    addTick(flaky)
    frame(12)
    expect(flaky).toHaveBeenCalledTimes(12)
    removeTick(flaky)
  })

  it('removeTick stops a callback and ignores unknown ones', () => {
    const fn = vi.fn()
    addTick(fn)
    frame()
    removeTick(fn)
    frame()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(() => removeTick(() => {})).not.toThrow()
  })

  it('does not run while the tab is hidden', () => {
    const fn = vi.fn()
    addTick(fn)
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    frame(3)
    expect(fn).not.toHaveBeenCalled()
    hidden.mockReturnValue(false)
    frame()
    expect(fn).toHaveBeenCalledTimes(1)
    removeTick(fn)
  })
})

describe('cappedTick', () => {
  it('skips frames that arrive faster than 60 Hz', () => {
    const fn = vi.fn()
    const tick = cappedTick(fn)
    // a 120 Hz screen: frames 1/120 s apart
    for (let i = 0; i < 12; i++) tick(i / 120, 8.33, i)
    expect(fn).toHaveBeenCalledTimes(6)
  })

  it('lets every frame through at 60 Hz and below', () => {
    const fn = vi.fn()
    const tick = cappedTick(fn)
    for (let i = 0; i < 6; i++) tick(i / 60, 16.6, i)
    for (let i = 0; i < 4; i++) tick(0.1 + i / 30, 33, i)
    expect(fn).toHaveBeenCalledTimes(10)
  })

  it('passes the arguments through', () => {
    const fn = vi.fn()
    cappedTick(fn)(1, 16, 7)
    expect(fn).toHaveBeenCalledWith(1, 16, 7)
  })

  it('never runs more than about hz times a second, whatever the frame spacing', () => {
    forAll(
      100,
      [
        [0.004, 0.05],
        [20, 60],
      ],
      (spacing, hz) => {
        const fn = vi.fn()
        const tick = cappedTick(fn, hz)
        const seconds = 5
        const frames = Math.floor(seconds / spacing)
        for (let i = 0; i < frames; i++) tick(i * spacing, spacing * 1000, i)
        // A frame may arrive 3 ms early without being dropped, so allow some slack.
        expect(fn.mock.calls.length).toBeLessThanOrEqual(seconds * hz * 1.3 + 2)
        expect(fn.mock.calls.length).toBeGreaterThan(0)
      },
    )
  })
})
