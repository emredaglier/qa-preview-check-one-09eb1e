import type { Payload } from 'payload'

import { PLACEHOLDER_SITE } from './placeholder'

export type SeedStatus = 'seeded' | 'unchanged' | 'edited' | 'overwritten'
export type SeedResult = Record<'site', SeedStatus>

export type SeedOptions = {
  /** Overwrite globals that were edited in the admin. */
  force?: boolean
  log?: (message: string) => void
}

/** Drops row ids and key order, so a stored global compares equal to the data that made it. */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key, v]) => key !== 'id' && v !== undefined && v !== null)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => [key, normalize(v)]),
    )
  }
  return value
}

const sameContent = (current: Record<string, unknown>, seed: Record<string, unknown>) =>
  Object.keys(seed).every(
    (key) => JSON.stringify(normalize(current[key])) === JSON.stringify(normalize(seed[key])),
  )

/**
 * Fills the Site global with the placeholder text. Safe to run twice: a global that already holds
 * the seed text is left alone, and one that differs (edited in the admin) is refused unless
 * `force`. A global that was never saved is simply seeded.
 */
export async function runSeed(payload: Payload, options: SeedOptions = {}): Promise<SeedResult> {
  const log = options.log ?? (() => undefined)
  const data: Record<string, unknown> = { ...PLACEHOLDER_SITE }
  const current = (await payload.findGlobal({ slug: 'site', depth: 0 })) as unknown as Record<
    string,
    unknown
  >
  const neverSaved = !current.createdAt

  let status: SeedStatus
  if (!neverSaved && sameContent(current, data)) {
    status = 'unchanged'
  } else if (!neverSaved && !options.force) {
    status = 'edited'
  } else {
    await payload.updateGlobal({ slug: 'site', data: data as never, depth: 0 })
    status = neverSaved ? 'seeded' : 'overwritten'
  }
  log(`site: ${status}`)
  return { site: status }
}
