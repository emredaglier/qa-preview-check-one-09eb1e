import config from '@payload-config'
import { getPayload } from 'payload'

import { LIVE_EDIT } from '../../../smoke/fixture-data'

/**
 * Smoke gate only (smoke/run.ts): saves the Site global once through the Local API, with
 * REVALIDATE_URLS pointing at the running web container, so the spec can check that the save
 * reaches the cached home page. Run through `payload run`, like seed.ts.
 */
const payload = await getPayload({ config })
try {
  const site = await payload.findGlobal({ slug: 'site', depth: 0 })
  await payload.updateGlobal({
    slug: 'site',
    data: { name: site.name, tagline: LIVE_EDIT.tagline },
    depth: 0,
  })
  console.log('smoke live edit saved.')
} finally {
  await payload.db.destroy?.()
}
process.exit(0)
