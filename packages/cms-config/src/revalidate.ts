import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  GlobalAfterChangeHook,
} from 'payload'

import { collectionTag, docTag, globalTag, REVALIDATE_SECRET_HEADER } from './tags'

export type RevalidateOptions = {
  /** Full URLs of every `web` instance's revalidation route (public site and preview). */
  urls: string[]
  secret: string
  /** Per-URL timeout. A slow or dead web must not hold up a save. */
  timeoutMs?: number
}

export const DEFAULT_REVALIDATE_TIMEOUT_MS = 2000

type Log = { error: (message: string) => void }

/**
 * POSTs the tags to every configured URL. Never throws: a failure is logged and the save goes on.
 * Returns the number of URLs that answered with a 2xx.
 */
export async function notifyRevalidate(
  options: RevalidateOptions,
  tags: string[],
  log: Log,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REVALIDATE_TIMEOUT_MS
  const results = await Promise.all(
    options.urls.map(async (url) => {
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [REVALIDATE_SECRET_HEADER]: options.secret,
          },
          body: JSON.stringify({ tags }),
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (!response.ok) {
          log.error(`Revalidate ${url} answered ${response.status} for tags ${tags.join(', ')}`)
          return false
        }
        return true
      } catch (error) {
        log.error(
          `Revalidate ${url} failed for tags ${tags.join(', ')}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
        return false
      }
    }),
  )
  return results.filter(Boolean).length
}

/** `afterChange` hook for a global: tells every web instance that the global changed. */
export function revalidateGlobalHook(
  options: RevalidateOptions | undefined,
  fetchImpl?: typeof fetch,
): GlobalAfterChangeHook {
  return async ({ global, doc, req }) => {
    if (options && options.urls.length > 0) {
      await notifyRevalidate(options, [globalTag(global.slug)], req.payload.logger, fetchImpl)
    }
    return doc
  }
}

/**
 * `afterChange` / `afterDelete` hooks for a collection: tell every web instance that one document
 * and the collection's lists changed.
 */
export function revalidateCollectionHooks(
  options: RevalidateOptions | undefined,
  extraTags: string[] = [],
  fetchImpl?: typeof fetch,
): { afterChange: CollectionAfterChangeHook[]; afterDelete: CollectionAfterDeleteHook[] } {
  const notify = async (collection: string, id: string | number, log: Log) => {
    if (!options || options.urls.length === 0) return
    await notifyRevalidate(
      options,
      [docTag(collection, id), collectionTag(collection), ...extraTags],
      log,
      fetchImpl,
    )
  }
  return {
    afterChange: [
      async ({ collection, doc, req }) => {
        await notify(collection.slug, doc.id, req.payload.logger)
        return doc
      },
    ],
    afterDelete: [
      async ({ collection, doc, req }) => {
        await notify(collection.slug, doc.id, req.payload.logger)
        return doc
      },
    ],
  }
}
