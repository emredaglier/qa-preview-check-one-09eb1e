import { configDefaults, defineConfig } from 'vitest/config'
import { canListenLocally, socketSuitesToSkip } from './infra/local-sockets.ts'

const skipped = socketSuitesToSkip(canListenLocally(), process.env.CI === 'true')
if (skipped.length > 0) {
  console.warn(
    `\nNo local sockets here, so these suites are skipped (CI runs them): ${skipped.join(', ')}\n`,
  )
}

export default defineConfig({
  test: {
    include: [
      'scripts/**/*.test.ts',
      'infra/**/*.test.ts',
      'smoke/**/*.test.ts',
      'perf/**/*.test.ts',
      '{apps,packages}/*/src/**/*.test.{ts,tsx}',
    ],
    exclude: [...configDefaults.exclude, ...skipped],
  },
})
