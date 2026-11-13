import { MAX_TAGS_PER_REQUEST, REVALIDATE_SECRET_HEADER, TAG_PATTERN } from '@house/cms-config/tags'
import { revalidateTag } from 'next/cache'

import { secretMatches } from '../../../lib/revalidate-auth'

/**
 * Called by `cms` after a save, over the internal network. Not under `/api` on purpose; Caddy
 * blocks `/internal/*` from the public internet, and the shared secret is the
 * second lock.
 */
export async function POST(request: Request): Promise<Response> {
  if (
    !secretMatches(request.headers.get(REVALIDATE_SECRET_HEADER), process.env.REVALIDATE_SECRET)
  ) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  let tags: unknown
  try {
    tags = ((await request.json()) as { tags?: unknown }).tags
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 })
  }
  if (
    !Array.isArray(tags) ||
    tags.length === 0 ||
    tags.length > MAX_TAGS_PER_REQUEST ||
    !tags.every((tag) => typeof tag === 'string' && TAG_PATTERN.test(tag))
  ) {
    return Response.json({ error: 'invalid tags' }, { status: 400 })
  }

  // expire: 0 means the next request reads fresh data instead of a stale copy.
  for (const tag of tags as string[]) revalidateTag(tag, { expire: 0 })
  return Response.json({ revalidated: tags })
}
