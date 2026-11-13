import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { IDLE_PATH, SCENARIOS, skipReason } from './scenarios.ts'

const idleEntry = () => ({ id: 'idle check', path: IDLE_PATH })

describe('scenario registry', () => {
  it('has unique ids', () => {
    const ids = SCENARIOS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every scenario names the page it runs on and the element that proves the feature exists', () => {
    for (const s of SCENARIOS) {
      expect(s.path.startsWith('/')).toBe(true)
      expect(s.requires.length).toBeGreaterThan(0)
      expect(s.steps.length).toBeGreaterThan(0)
    }
  })

  it('every route a scenario or the idle check names exists in the web app', () => {
    const paths = [...SCENARIOS.map((s) => ({ id: s.id, path: s.path })), idleEntry()]
    for (const { id, path } of paths) {
      if (path === null) continue
      const page = resolve(import.meta.dirname, '../apps/web/src/app', `.${path}`, 'page.tsx')
      expect(existsSync(page), `${id}: no page at ${path}`).toBe(true)
    }
  })

  it('every frame budget names a scenario that exists, so deleting a scenario means deleting its budget', () => {
    const budget = JSON.parse(
      readFileSync(resolve(import.meta.dirname, 'perf-budget.json'), 'utf8'),
    )
    const ids = new Set(SCENARIOS.map((s) => s.id))
    for (const key of Object.keys(budget.frames ?? {})) {
      expect(ids.has(key.slice(key.indexOf('/') + 1)), `${key}: no such scenario`).toBe(true)
    }
  })
})

describe('skipReason', () => {
  const scenario = {
    id: 'example',
    title: 'Example',
    path: '/',
    requires: 'canvas[data-perf="example"]',
    steps: [{ do: 'wait' as const, ms: 1 }],
  }
  it('skips a scenario whose feature is not on the page, with a notice', () => {
    expect(skipReason(scenario, 0)).toContain(scenario.requires)
  })
  it('runs it when the feature is there', () => {
    expect(skipReason(scenario, 1)).toBeNull()
  })
})
