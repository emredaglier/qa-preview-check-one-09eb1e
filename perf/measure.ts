// Measures the site at PERF_BASE_URL (or, when run by `pnpm perf` through the smoke runner,
// SMOKE_BASE_URL) and writes perf/.output/report.json.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Report } from './budget.ts'
import { runFrames } from './frames.ts'
import { runIdle } from './idle.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const baseUrl = process.env.PERF_BASE_URL ?? process.env.SMOKE_BASE_URL
if (!baseUrl) throw new Error('SMOKE_BASE_URL (or PERF_BASE_URL) is not set')

const frames = await runFrames(baseUrl)
const idle = await runIdle(baseUrl)
const report: Report = { generatedAt: new Date().toISOString(), frames, idle }

const out = process.env.PERF_REPORT ?? path.join(here, '.output/report.json')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n')
console.log(`[perf] report written to ${out}`)
