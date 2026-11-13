export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

export const clamp01 = (n: number): number => clamp(n, 0, 1)

/**
 * Frame-rate-independent exponential smoothing of `current` towards `target` at `rate` per
 * second. Snaps to `target` once within 0.01.
 */
export const smoothToward = (
  current: number,
  target: number,
  dtSeconds: number,
  rate: number,
): number => {
  const next = current + (target - current) * (1 - Math.exp(-dtSeconds * rate))
  return Math.abs(target - next) < 0.01 ? target : next
}
