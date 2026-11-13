// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { cubicBezierEase, parseCubicBezier, readEase, type Bezier } from './ease'
import { forAll } from './test-support'

describe('cubic-bezier ease', () => {
  it('parses a CSS cubic-bezier()', () => {
    expect(parseCubicBezier('cubic-bezier(0.7, 0, 0.3, 1)')).toEqual([0.7, 0, 0.3, 1])
    expect(parseCubicBezier(' cubic-bezier(.25,.1,.25,1) ')).toEqual([0.25, 0.1, 0.25, 1])
  })

  it('rejects anything else', () => {
    expect(parseCubicBezier('ease')).toBeNull()
    expect(parseCubicBezier('cubic-bezier(1,2,3)')).toBeNull()
  })

  it('pins the ends and is linear for (0,0,1,1)', () => {
    const linear = cubicBezierEase([0, 0, 1, 1])
    for (const x of [0, 0.1, 0.5, 0.9, 1]) expect(linear(x)).toBeCloseTo(x, 3)
    const inOutEase = cubicBezierEase([0.7, 0, 0.3, 1])
    expect(inOutEase(0)).toBe(0)
    expect(inOutEase(1)).toBe(1)
  })

  it('matches the known values of the CSS `ease` curve', () => {
    // Reference values of cubic-bezier(0.25, 0.1, 0.25, 1) (browser easing tables).
    const ease = cubicBezierEase([0.25, 0.1, 0.25, 1])
    expect(ease(0.25)).toBeCloseTo(0.4085, 3)
    expect(ease(0.5)).toBeCloseTo(0.8024, 3)
    expect(ease(0.75)).toBeCloseTo(0.9604, 3)
  })

  it('is symmetric for the in-out token', () => {
    const inOut = cubicBezierEase([0.65, 0, 0.35, 1])
    expect(inOut(0.5)).toBeCloseTo(0.5, 3)
    expect(inOut(0.2) + inOut(0.8)).toBeCloseTo(1, 3)
  })

  it('reads a custom property from the document', () => {
    document.documentElement.style.setProperty('--ease-example', 'cubic-bezier(0.7, 0, 0.3, 1)')
    const ease = readEase('--ease-example')
    expect(ease(0.5)).toBeCloseTo(0.5, 3)
    expect(ease(0.25)).toBeLessThan(0.25)
  })

  it('falls back to linear when the property is missing or invalid', () => {
    expect(readEase('--nope')(0.3)).toBeCloseTo(0.3, 6)
  })

  it('stays within 0..1 and never decreases for any bezier whose y handles are within 0..1', () => {
    forAll(
      60,
      [
        [0, 1],
        [0, 1],
        [0, 1],
        [0, 1],
      ],
      (x1, y1, x2, y2) => {
        const ease = cubicBezierEase([x1, y1, x2, y2])
        let previous = 0
        for (let i = 0; i <= 50; i++) {
          const out = ease(i / 50)
          expect(out).toBeGreaterThanOrEqual(0)
          expect(out).toBeLessThanOrEqual(1)
          expect(out).toBeGreaterThanOrEqual(previous - 1e-6)
          previous = out
        }
      },
    )
  })

  it('matches a brute-force sample of the curve', () => {
    forAll(
      30,
      [
        [0, 1],
        [0, 1],
        [0, 1],
        [0, 1],
      ],
      (x1, y1, x2, y2) => {
        const curve: Bezier = [x1, y1, x2, y2]
        const ease = cubicBezierEase(curve)
        // Walk the curve by its parameter and compare at every sampled point.
        for (let i = 1; i < 100; i++) {
          const t = i / 100
          const u = 1 - t
          const x = 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t
          const y = 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t
          expect(ease(x)).toBeCloseTo(y, 4)
        }
      },
    )
  })
})
