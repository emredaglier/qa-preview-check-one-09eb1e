import { describe, expect, it } from 'vitest'
import { clamp, clamp01, smoothToward } from './math'
import { forAll } from './test-support'

describe('clamp', () => {
  it('always lands inside the range, and leaves a value inside it alone', () => {
    forAll(
      500,
      [
        [-100, 100],
        [-50, 0],
        [0, 50],
      ],
      (v, lo, hi) => {
        const out = clamp(v, lo, hi)
        expect(out).toBeGreaterThanOrEqual(lo)
        expect(out).toBeLessThanOrEqual(hi)
        if (v >= lo && v <= hi) expect(out).toBe(v)
        expect(clamp(out, lo, hi)).toBe(out)
      },
    )
  })

  it('worked examples', () => {
    expect(clamp(5, 0, 3)).toBe(3)
    expect(clamp(-5, -1, 3)).toBe(-1)
    expect(clamp01(1.5)).toBe(1)
    expect(clamp01(-0.2)).toBe(0)
    expect(clamp01(0.4)).toBe(0.4)
  })
})

describe('smoothToward', () => {
  it('moves towards the target and never overshoots it', () => {
    forAll(
      500,
      [
        [-100, 100],
        [-100, 100],
        [0, 2],
        [0.1, 20],
      ],
      (current, target, dt, rate) => {
        const next = smoothToward(current, target, dt, rate)
        const lo = Math.min(current, target)
        const hi = Math.max(current, target)
        expect(next).toBeGreaterThanOrEqual(lo - 1e-9)
        expect(next).toBeLessThanOrEqual(hi + 1e-9)
        expect(Math.abs(target - next)).toBeLessThanOrEqual(Math.abs(target - current) + 1e-9)
      },
    )
  })

  it('does not depend on the frame rate: two half steps equal one whole step', () => {
    forAll(
      300,
      [
        [0, 10],
        [50, 100],
        [0.01, 0.5],
        [0.5, 10],
      ],
      (current, target, dt, rate) => {
        const whole = smoothToward(current, target, dt, rate)
        const half = smoothToward(smoothToward(current, target, dt / 2, rate), target, dt / 2, rate)
        // Far from the target, so the snap never applies.
        expect(half).toBeCloseTo(whole, 6)
      },
    )
  })

  it('stands still for no time and reaches the target in the end', () => {
    expect(smoothToward(3, 10, 0, 5)).toBe(3)
    let value = 0
    for (let i = 0; i < 600; i++) value = smoothToward(value, 10, 1 / 60, 5)
    expect(value).toBe(10)
  })

  it('worked example: after one second at rate 1 it has covered 63% of the way', () => {
    expect(smoothToward(0, 100, 1, 1)).toBeCloseTo(63.2, 1)
  })

  it('snaps when within 0.01 of the target', () => {
    expect(smoothToward(99.999, 100, 0.001, 5)).toBe(100)
  })
})
