// Shared by the live-edit script (apps/cms/scripts/smoke-live-edit.ts) and the browser spec.

/** A path no route serves: the 404 page. */
export const UNKNOWN_PATH = '/this/page/does-not-exist'

/**
 * Saved through the Local API after the web container is up and its home page is cached
 * (smoke/run.ts, apps/cms/scripts/smoke-live-edit.ts), so only the revalidate hook can make it
 * show on the next request.
 */
export const LIVE_EDIT = {
  tagline: 'Edited through the Local API while the container was running.',
}
