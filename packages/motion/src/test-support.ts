// Helpers for property tests: a seeded generator, so a failing case can be reproduced.

/** mulberry32: a small deterministic generator returning numbers in [0, 1). */
export const seeded = (seed: number): (() => number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Runs `check` with `count` random numbers in [lo, hi) per call, from a fixed seed. */
export const forAll = (
  count: number,
  ranges: readonly (readonly [number, number])[],
  check: (...values: number[]) => void,
  seed = 1,
): void => {
  const random = seeded(seed)
  for (let i = 0; i < count; i++) {
    check(...ranges.map(([lo, hi]) => lo + random() * (hi - lo)))
  }
}
