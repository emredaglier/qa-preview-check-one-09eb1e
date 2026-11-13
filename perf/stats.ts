// Frame-time maths for the perf suite. Pure, so it is unit-tested.

/** A frame longer than this counts as dropped: 1.5 x the 60 Hz budget of 16.7 ms. */
export const DROPPED_FRAME_MS = 25

export type FrameSummary = {
  frames: number
  p50Ms: number
  p95Ms: number
  maxMs: number
  /** Share of frames (0-100) that took longer than DROPPED_FRAME_MS. */
  droppedPct: number
}

/** requestAnimationFrame timestamps (ms) to the duration of each frame between them. */
export function framesFromTimestamps(timestamps: number[]): number[] {
  const durations: number[] = []
  for (let i = 1; i < timestamps.length; i++) durations.push(timestamps[i]! - timestamps[i - 1]!)
  return durations
}

/** Nearest-rank percentile of an ascending-sorted list. */
function percentile(sorted: number[], p: number): number {
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!
}

export const round1 = (n: number) => Math.round(n * 10) / 10

export function summarizeFrames(durations: number[]): FrameSummary {
  if (durations.length === 0) return { frames: 0, p50Ms: 0, p95Ms: 0, maxMs: 0, droppedPct: 0 }
  const sorted = [...durations].sort((a, b) => a - b)
  const dropped = sorted.filter((d) => d > DROPPED_FRAME_MS).length
  return {
    frames: sorted.length,
    p50Ms: round1(percentile(sorted, 50)),
    p95Ms: round1(percentile(sorted, 95)),
    maxMs: round1(sorted[sorted.length - 1]!),
    droppedPct: round1((dropped / sorted.length) * 100),
  }
}
