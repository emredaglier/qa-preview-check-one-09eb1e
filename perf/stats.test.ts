import { describe, expect, it } from 'vitest'

import { seeded } from '../packages/motion/src/test-support.ts'
import { framesFromTimestamps, summarizeFrames } from './stats.ts'

describe('framesFromTimestamps', () => {
  it('turns rAF timestamps into frame durations', () => {
    expect(framesFromTimestamps([0, 16, 33, 50])).toEqual([16, 17, 17])
  })
  it('needs two timestamps to have a frame', () => {
    expect(framesFromTimestamps([5])).toEqual([])
  })
})

describe('summarizeFrames', () => {
  it('reports percentiles, max and the share of slow frames', () => {
    const durations = [...Array.from({ length: 18 }, () => 16), 40, 100]
    const s = summarizeFrames(durations)
    expect(s.frames).toBe(20)
    expect(s.p50Ms).toBe(16)
    expect(s.p95Ms).toBe(40)
    expect(s.maxMs).toBe(100)
    // 2 of 20 frames took longer than 1.5 x 16.7 ms
    expect(s.droppedPct).toBe(10)
  })
  it('returns zeros for no frames', () => {
    expect(summarizeFrames([])).toEqual({ frames: 0, p50Ms: 0, p95Ms: 0, maxMs: 0, droppedPct: 0 })
  })
  it('orders p50 <= p95 <= max and keeps the dropped share within 0..100, for any frames', () => {
    const random = seeded(7)
    for (let run = 0; run < 200; run++) {
      const durations = Array.from({ length: 1 + Math.floor(random() * 120) }, () => random() * 200)
      const s = summarizeFrames(durations)
      expect(s.p50Ms).toBeLessThanOrEqual(s.p95Ms)
      expect(s.p95Ms).toBeLessThanOrEqual(s.maxMs)
      expect(s.droppedPct).toBeGreaterThanOrEqual(0)
      expect(s.droppedPct).toBeLessThanOrEqual(100)
    }
  })
})
