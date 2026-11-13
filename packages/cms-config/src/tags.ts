/**
 * Cache tag names shared by `cms` (which sends them) and `web` (which tags its cached reads).
 * Pure strings, no Payload imports, so `web` can import `@house/cms-config/tags` cheaply.
 */

/** Tag for a whole global, e.g. `global:site`. */
export const globalTag = (slug: string): string => `global:${slug}`

/** Tag for one document of a collection, e.g. `doc:pages:12`. */
export const docTag = (collection: string, id: string | number): string => `doc:${collection}:${id}`

/** Tag for every list/query of a collection, e.g. `collection:pages`. */
export const collectionTag = (collection: string): string => `collection:${collection}`

/** What the revalidation route accepts: our own tag shapes only. */
export const TAG_PATTERN = /^(global|collection):[a-z0-9-]+$|^doc:[a-z0-9-]+:[A-Za-z0-9_-]+$/
export const MAX_TAGS_PER_REQUEST = 50

/** Header carrying the shared secret on a revalidation request. */
export const REVALIDATE_SECRET_HEADER = 'x-revalidate-secret'
