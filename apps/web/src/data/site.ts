import { globalTag } from '@house/cms-config/tags'
import { unstable_cache } from 'next/cache'

import { getWebPayload } from '../lib/payload'
import type { SiteDoc } from '@house/cms-config'

/**
 * Data-access pattern for `web` (copy it for every further read):
 *  - one function per read in `src/data/`, wrapped in `unstable_cache`;
 *  - tag it with the same tag `cms` sends (`globalTag`, `docTag`, `collectionTag`);
 *  - pass `overrideAccess: false`, because the Local API skips access rules by default;
 *  - return plain JSON (the cache serialises it).
 */
export const getSite = unstable_cache(
  async (): Promise<SiteDoc> => {
    const payload = await getWebPayload()
    return payload.findGlobal({ slug: 'site', overrideAccess: false, depth: 0 })
  },
  ['site'],
  { tags: [globalTag('site')] },
)
