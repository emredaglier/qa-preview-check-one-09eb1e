export type Bezier = readonly [number, number, number, number]
export type EaseFn = (t: number) => number

const NUMBER = String.raw`(-?(?:\d+\.?\d*|\.\d+))`
const PATTERN = new RegExp(
  String.raw`^\s*cubic-bezier\(\s*${NUMBER}\s*,\s*${NUMBER}\s*,\s*${NUMBER}\s*,\s*${NUMBER}\s*\)\s*$`,
)

/** Parses `cubic-bezier(x1, y1, x2, y2)`; null for anything else. */
export const parseCubicBezier = (css: string): Bezier | null => {
  const match = PATTERN.exec(css)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])]
}

const BISECT_STEPS = 24

/** A GSAP-compatible ease (`t` 0..1 -> 0..1) for a CSS cubic-bezier: bisects x(t), returns y(t). */
export const cubicBezierEase = ([x1, y1, x2, y2]: Bezier): EaseFn => {
  const at = (t: number, a: number, b: number) => {
    const u = 1 - t
    return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t
  }
  return (x) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let lo = 0
    let hi = 1
    for (let i = 0; i < BISECT_STEPS; i++) {
      const mid = (lo + hi) / 2
      if (at(mid, x1, x2) < x) lo = mid
      else hi = mid
    }
    return at((lo + hi) / 2, y1, y2)
  }
}

const linear: EaseFn = (t) => t

/**
 * Reads a CSS custom property holding a cubic-bezier (e.g. `--ease-example`) and returns its ease.
 * Linear when the property is missing or invalid. Read once per sequence, not per frame.
 */
export const readEase = (property: string, element?: Element): EaseFn => {
  if (typeof document === 'undefined') return linear
  const value = getComputedStyle(element ?? document.documentElement).getPropertyValue(property)
  const bezier = parseCubicBezier(value)
  return bezier ? cubicBezierEase(bezier) : linear
}
