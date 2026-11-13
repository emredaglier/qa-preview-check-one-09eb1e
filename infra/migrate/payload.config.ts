// Config for the `migrate` image only. Payload's CLI needs a config file; this one builds the
// same config as `apps/cms` (role `cms`, so it owns the DB file) without the admin UI.
import { buildSiteConfig, siteConfigOptionsFromEnv } from './src/index.ts'

export default buildSiteConfig(siteConfigOptionsFromEnv('cms'))
