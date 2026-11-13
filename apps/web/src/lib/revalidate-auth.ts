import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Compares the presented secret with the configured one in constant time. Both are hashed first,
 * so the comparison length never depends on the input. An unset or empty secret never matches.
 */
export function secretMatches(presented: string | null, expected: string | undefined): boolean {
  if (!expected || !presented) return false
  const a = createHash('sha256').update(presented).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}
