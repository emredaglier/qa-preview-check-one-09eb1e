import config from '@payload-config'
import { runSeed } from '@house/cms-config/seed'
import { getPayload } from 'payload'

/**
 * `pnpm seed [--force]`: fills the Site global with placeholder text.
 * Run through `payload run`, so it loads .env, the config and tsx like the migrations do.
 * Needs the schema migrated first (`pnpm migrate`).
 */
const payload = await getPayload({ config })
try {
  const force = process.argv.includes('--force')
  await runSeed(payload, { force, log: (message) => console.log(`seed ${message}`) })
  console.log('seed done.')
} finally {
  await payload.db.destroy?.()
}
process.exit(0)
