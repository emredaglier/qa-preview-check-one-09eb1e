// The report `pnpm perf` writes, the budget `pnpm perf:check` compares it to, and the maths
// between them. Pure, so it is unit-tested.
import { round1, type FrameSummary } from './stats.ts'

export type FrameResult = ({ status: 'ok' } & FrameSummary) | { status: 'skipped'; reason: string }
export type IdleResult =
  | { status: 'ok'; cpuPct: number; sampleSeconds: number; rafPerSec?: number }
  | { status: 'skipped'; reason: string }

export type Report = {
  generatedAt: string
  /** Keyed `<project>/<scenario id>`, e.g. `chromium-4x/pointer-sweep`. */
  frames: Record<string, FrameResult>
  idle: IdleResult
}

export type Budget = {
  frames?: Record<string, { p95Ms: number; droppedPct: number }>
  idle?: { cpuPct: number }
}

/** Failure messages; an empty list means the report is within budget. */
export function checkBudget(report: Report, budget: Budget): string[] {
  const failures: string[] = []
  for (const [key, limit] of Object.entries(budget.frames ?? {})) {
    const result = report.frames[key]
    if (!result) {
      failures.push(`${key}: budgeted but missing from the report`)
      continue
    }
    if (result.status === 'skipped') continue
    for (const metric of ['p95Ms', 'droppedPct'] as const) {
      if (result[metric] > limit[metric]) {
        failures.push(`${key}: ${metric} ${result[metric]} is over the budget of ${limit[metric]}`)
      }
    }
  }
  if (budget.idle && report.idle.status === 'ok' && report.idle.cpuPct > budget.idle.cpuPct) {
    failures.push(`idle: cpuPct ${report.idle.cpuPct} is over the budget of ${budget.idle.cpuPct}`)
  }
  return failures
}

const FLOORS = { p95Ms: 50, droppedPct: 5, cpuPct: 5 }

/** A budget from a report: every measured number times `headroom`, never below a floor. */
export function recordBudget(report: Report, headroom: number): Budget {
  const frames: NonNullable<Budget['frames']> = {}
  for (const [key, result] of Object.entries(report.frames)) {
    if (result.status !== 'ok') continue
    frames[key] = {
      p95Ms: round1(Math.max(result.p95Ms * headroom, FLOORS.p95Ms)),
      droppedPct: round1(Math.max(result.droppedPct * headroom, FLOORS.droppedPct)),
    }
  }
  const budget: Budget = { frames }
  if (report.idle.status === 'ok') {
    budget.idle = { cpuPct: round1(Math.max(report.idle.cpuPct * headroom, FLOORS.cpuPct)) }
  }
  return budget
}
