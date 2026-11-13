/**
 * What counts as a smoke failure. Console errors, page errors, failed requests and 4xx/5xx
 * subresources all fail; the one allow-listed exception is the page's own document answering
 * the status the route is expected to give (the intended 404 page).
 */
export type Expectation = {
  /** URL of the document under test. */
  url: string
  /** Status the document is expected to have (200 for most routes, 404 for the 404 page). */
  status: number
}

export type ConsoleObservation = { type: string; text: string; location?: string }
export type ResponseObservation = { url: string; status: number; isDocument: boolean }
export type RequestFailure = {
  url: string
  reason: string | null | undefined
  /** False in the JS-disabled project. */
  jsEnabled?: boolean
}

const sameUrl = (a: string, b: string) => a.replace(/\/$/, '') === b.replace(/\/$/, '')

export function consoleFailure(
  message: ConsoleObservation,
  expected: Expectation,
): string | undefined {
  if (message.type !== 'error') return undefined
  // Chromium reports the failed load of the intended 404 document as a console error.
  if (
    expected.status >= 400 &&
    message.text.includes('Failed to load resource') &&
    message.text.includes(`status of ${expected.status}`) &&
    message.location &&
    sameUrl(message.location, expected.url)
  ) {
    return undefined
  }
  return `console error: ${message.text}${message.location ? ` (${message.location})` : ''}`
}

export function responseFailure(
  response: ResponseObservation,
  expected: Expectation,
): string | undefined {
  if (response.status < 400) return undefined
  if (
    response.isDocument &&
    sameUrl(response.url, expected.url) &&
    response.status === expected.status
  ) {
    return undefined
  }
  return `HTTP ${response.status}: ${response.url}`
}

/** A cancelled `_rsc` prefetch (a link scrolled away, or the page closing) is not a failure. */
const isCancelledPrefetch = (failure: RequestFailure) =>
  failure.reason === 'net::ERR_ABORTED' && /[?&]_rsc=/.test(failure.url)

export function requestFailure(failure: RequestFailure): string | undefined {
  if (isCancelledPrefetch(failure)) return undefined
  // Playwright enforces "JS disabled" with a CSP that blocks the page's scripts: expected there.
  if (failure.jsEnabled === false && failure.reason === 'csp') return undefined
  return `request failed (${failure.reason ?? 'unknown'}): ${failure.url}`
}

export const pageErrorFailure = (error: Error): string => `page error: ${error.message}`
