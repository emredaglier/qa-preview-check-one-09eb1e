import { describe, expect, it } from 'vitest'
import { forAll } from '../test-support'
import { canvasSize, falloff, followPoint, toCanvasPoint } from './math'

describe('falloff', () => {
  it('stays within 0..1 and never rises as the distance grows', () => {
    forAll(300, [[1, 500]], (radius) => {
      let previous = 1
      for (let i = 0; i <= 100; i++) {
        const value = falloff((i / 100) * radius * 1.5, radius)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
        expect(value).toBeLessThanOrEqual(previous + 1e-12)
        previous = value
      }
    })
  })

  it('is full strength at the centre and gone at and beyond the radius', () => {
    forAll(
      100,
      [
        [1, 500],
        [0, 3],
      ],
      (radius, extra) => {
        expect(falloff(0, radius)).toBe(1)
        expect(falloff(radius, radius)).toBe(0)
        expect(falloff(radius + extra, radius)).toBe(0)
      },
    )
  })

  it('is point-symmetric: what is lost at distance d is what remains at radius - d', () => {
    forAll(
      300,
      [
        [1, 500],
        [0, 1],
      ],
      (radius, share) => {
        const d = share * radius
        expect(falloff(d, radius) + falloff(radius - d, radius)).toBeCloseTo(1, 9)
      },
    )
  })

  it('draws nothing for a radius that is not positive', () => {
    expect(falloff(0, 0)).toBe(0)
    expect(falloff(5, -3)).toBe(0)
    expect(falloff(Number.NaN, 10)).toBe(0)
  })

  it('worked examples on a radius of 100', () => {
    expect(falloff(50, 100)).toBeCloseTo(0.5, 12)
    expect(falloff(25, 100)).toBeCloseTo(0.84375, 12)
    expect(falloff(75, 100)).toBeCloseTo(0.15625, 12)
  })
})

describe('followPoint', () => {
  it('moves each axis towards the target without overshooting', () => {
    forAll(
      300,
      [
        [-500, 500],
        [-500, 500],
        [-500, 500],
        [-500, 500],
        [0.001, 0.5],
      ],
      (x, y, tx, ty, dt) => {
        const next = followPoint({ x, y }, { x: tx, y: ty }, dt, 8)
        expect(next.x).toBeGreaterThanOrEqual(Math.min(x, tx) - 1e-9)
        expect(next.x).toBeLessThanOrEqual(Math.max(x, tx) + 1e-9)
        expect(next.y).toBeGreaterThanOrEqual(Math.min(y, ty) - 1e-9)
        expect(next.y).toBeLessThanOrEqual(Math.max(y, ty) + 1e-9)
      },
    )
  })

  it('settles exactly on the target so the loop can stop drawing', () => {
    let point = { x: 0, y: 0 }
    for (let i = 0; i < 600; i++) point = followPoint(point, { x: 300, y: -40 }, 1 / 60, 8)
    expect(point).toEqual({ x: 300, y: -40 })
  })

  it('worked example: one second at rate 1 covers 63% of the way on both axes', () => {
    const next = followPoint({ x: 0, y: 100 }, { x: 100, y: 0 }, 1, 1)
    expect(next.x).toBeCloseTo(63.2, 1)
    expect(next.y).toBeCloseTo(36.8, 1)
  })
})

describe('canvasSize', () => {
  it('is at least 1x1, never above the cap, and scales with the CSS size', () => {
    forAll(
      300,
      [
        [0, 4000],
        [0, 4000],
        [0.5, 4],
        [1, 2],
      ],
      (width, height, dpr, maxDpr) => {
        const size = canvasSize(width, height, dpr, maxDpr)
        expect(size.width).toBeGreaterThanOrEqual(1)
        expect(size.height).toBeGreaterThanOrEqual(1)
        expect(size.dpr).toBeLessThanOrEqual(maxDpr + 1e-12)
        expect(size.dpr).toBeLessThanOrEqual(Math.max(dpr, 1) + 1e-12)
        expect(size.width).toBeLessThanOrEqual(Math.max(1, Math.round(width * size.dpr)))
      },
    )
  })

  it('worked examples', () => {
    expect(canvasSize(1000, 600, 3, 1.5)).toEqual({ width: 1500, height: 900, dpr: 1.5 })
    expect(canvasSize(1000, 600, 1, 1.5)).toEqual({ width: 1000, height: 600, dpr: 1 })
    expect(canvasSize(0, 0, 2, 2)).toEqual({ width: 1, height: 1, dpr: 2 })
    expect(canvasSize(100, 100, Number.NaN, 2)).toEqual({ width: 100, height: 100, dpr: 1 })
  })
})

describe('toCanvasPoint', () => {
  const rect = { left: 100, top: 50, width: 400, height: 200 }
  const size = { width: 800, height: 400 }

  it('lands inside the canvas for any pointer, near or far', () => {
    forAll(
      300,
      [
        [-1000, 1000],
        [-1000, 1000],
      ],
      (clientX, clientY) => {
        const point = toCanvasPoint(clientX, clientY, rect, size)
        expect(point.x).toBeGreaterThanOrEqual(0)
        expect(point.x).toBeLessThanOrEqual(size.width)
        expect(point.y).toBeGreaterThanOrEqual(0)
        expect(point.y).toBeLessThanOrEqual(size.height)
      },
    )
  })

  it('maps the rectangle corners to the canvas corners and keeps order inside it', () => {
    expect(toCanvasPoint(100, 50, rect, size)).toEqual({ x: 0, y: 0 })
    expect(toCanvasPoint(500, 250, rect, size)).toEqual({ x: 800, y: 400 })
    forAll(
      200,
      [
        [100, 500],
        [100, 500],
        [50, 250],
      ],
      (a, b, y) => {
        const first = toCanvasPoint(a, y, rect, size)
        const second = toCanvasPoint(b, y, rect, size)
        expect(Math.sign(first.x - second.x)).toBe(Math.sign(a - b))
      },
    )
  })

  it('worked example: the middle of the rectangle is the middle of the canvas', () => {
    expect(toCanvasPoint(300, 150, rect, size)).toEqual({ x: 400, y: 200 })
  })

  it('falls back to the canvas centre for an empty rectangle', () => {
    expect(toCanvasPoint(10, 10, { left: 0, top: 0, width: 0, height: 0 }, size)).toEqual({
      x: 400,
      y: 200,
    })
  })
})
