// `pnpm perf:check`: compares perf/.output/report.json to perf/perf-budget.json.
//   pnpm perf:check            exit 1 if a number is over budget
//   pnpm perf:check --record   write a new budget from the report (2x headroom)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkBudget, recordBudget, type Budget, type Report } from './budget.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const reportPath = process.env.PERF_REPORT ?? path.join(here, '.output/report.json')
const budgetPath = path.join(here, 'perf-budget.json')

if (!fs.existsSync(reportPath)) {
  console.error(`[perf:check] no report at ${reportPath}; run \`pnpm perf\` first`)
  process.exit(1)
}
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as Report

if (process.argv.includes('--record')) {
  fs.writeFileSync(budgetPath, JSON.stringify(recordBudget(report, 2), null, 2) + '\n')
  console.log(`[perf:check] budget recorded to ${budgetPath}`)
  process.exit(0)
}

const budget = JSON.parse(fs.readFileSync(budgetPath, 'utf8')) as Budget
const failures = checkBudget(report, budget)
if (failures.length > 0) {
  for (const failure of failures) console.error(`[perf:check] ${failure}`)
  process.exit(1)
}
console.log('[perf:check] within budget')
