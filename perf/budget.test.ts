import { describe, expect, it } from 'vitest'

import { checkBudget, recordBudget, type Budget, type Report } from './budget.ts'

const report: Report = {
  generatedAt: '2026-01-01T00:00:00.000Z',
  frames: {
    'chromium-4x/glow-sweep': {
      status: 'ok',
      frames: 100,
      p50Ms: 17,
      p95Ms: 30,
      maxMs: 60,
      droppedPct: 4,
    },
    'webkit/glow-sweep': { status: 'skipped', reason: 'no canvas on the page' },
  },
  idle: { status: 'ok', cpuPct: 1.5, sampleSeconds: 5 },
}

describe('checkBudget', () => {
  it('passes when every measured number is within budget', () => {
    const budget: Budget = {
      frames: { 'chromium-4x/glow-sweep': { p95Ms: 40, droppedPct: 10 } },
      idle: { cpuPct: 5 },
    }
    expect(checkBudget(report, budget)).toEqual([])
  })
  it('names each number over budget', () => {
    const budget: Budget = {
      frames: { 'chromium-4x/glow-sweep': { p95Ms: 20, droppedPct: 10 } },
      idle: { cpuPct: 1 },
    }
    const failures = checkBudget(report, budget)
    expect(failures).toHaveLength(2)
    expect(failures[0]).toContain('chromium-4x/glow-sweep')
    expect(failures[0]).toContain('p95Ms')
    expect(failures[1]).toContain('idle')
  })
  it('does not fail a skipped scenario, but fails a budgeted one missing from the report', () => {
    const budget: Budget = {
      frames: {
        'webkit/glow-sweep': { p95Ms: 1, droppedPct: 1 },
        'webkit/second-scenario': { p95Ms: 1, droppedPct: 1 },
      },
    }
    const failures = checkBudget(report, budget)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('webkit/second-scenario')
  })
})

describe('recordBudget', () => {
  it('budgets measured numbers with headroom and ignores skipped scenarios', () => {
    const budget = recordBudget(report, 2)
    expect(budget.frames).toEqual({ 'chromium-4x/glow-sweep': { p95Ms: 60, droppedPct: 8 } })
    expect(budget.idle).toEqual({ cpuPct: 5 })
    expect(checkBudget(report, budget)).toEqual([])
  })
})
