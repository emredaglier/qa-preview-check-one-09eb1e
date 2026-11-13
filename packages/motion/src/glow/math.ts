import { clamp, clamp01, smoothToward } from '../math'

export type Point = { x: number; y: number }

/**
 * Strength of the glow at `distance` from its centre: 1 in the middle, 0 at `radius` and beyond,
 * eased in between (smoothstep of `1 - distance / radius`). The fragment shader computes the same
 * curve; keep the two in step.
 */
export const falloff = (distance: number, radius: number): number => {
  if (!(radius > 0) || !Number.isFinite(distance)) return 0
  const t = clamp01(1 - distance / radius)
  return t * t * (3 - 2 * t)
}

/** Moves `current` towards `target` on both axes (frame-rate independent). Settles exactly. */
export const followPoint = (
  current: Point,
  target: Point,
  dtSeconds: number,
  rate: number,
): Point => ({
  x: smoothToward(current.x, target.x, dtSeconds, rate),
  y: smoothToward(current.y, target.y, dtSeconds, rate),
})

export type CanvasSize = { width: number; height: number; dpr: number }

/**
 * The canvas backing store for a CSS size: `devicePixelRatio` capped at `maxDpr` (a glow does not
 * need a retina screen's full resolution) and at least 1x1.
 */
export const canvasSize = (
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  maxDpr: number,
): CanvasSize => {
  const dpr = Math.min(
    Number.isFinite(devicePixelRatio) ? Math.max(devicePixelRatio, 1) : 1,
    maxDpr,
  )
  return {
    width: Math.max(1, Math.round(cssWidth * dpr)),
    height: Math.max(1, Math.round(cssHeight * dpr)),
    dpr,
  }
}

export type Rect = { left: number; top: number; width: number; height: number }

/**
 * A pointer position in client px as a point on the canvas in device px, clamped to the canvas.
 * An empty rectangle (a hidden or unmounted canvas) gives the canvas centre.
 */
export const toCanvasPoint = (
  clientX: number,
  clientY: number,
  rect: Rect,
  size: { width: number; height: number },
): Point => {
  if (!(rect.width > 0) || !(rect.height > 0)) return { x: size.width / 2, y: size.height / 2 }
  return {
    x: clamp(((clientX - rect.left) / rect.width) * size.width, 0, size.width),
    y: clamp(((clientY - rect.top) / rect.height) * size.height, 0, size.height),
  }
}
