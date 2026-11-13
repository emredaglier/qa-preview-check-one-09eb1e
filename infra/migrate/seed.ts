// `docker compose run --rm migrate node node_modules/payload/bin.js run seed.ts -- [--force]`
// The `--` matters: `payload run` swallows flags before it, so `--force` only reaches this script after it.
// Same as `pnpm seed` (apps/cms/scripts/seed.ts) but against this image's config.
import config from './payload.config.ts'
import { runSeed } from './src/seed/seed.ts'
import { getPayload } from 'payload'

const payload = await getPayload({ config })
try {
  const force = process.argv.includes('--force')
  await runSeed(payload, { force, log: (message) => console.log(`seed ${message}`) })
  console.log('seed done.')
} finally {
  await payload.db.destroy?.()
}
process.exit(0)
