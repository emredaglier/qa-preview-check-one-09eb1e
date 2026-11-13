import { describe, expect, it } from 'vitest'

import { consoleFailure, requestFailure, responseFailure } from './failure-rules.ts'

const ok = { url: 'http://x/about', status: 200 }
const notFound = { url: 'http://x/nope', status: 404 }

describe('consoleFailure', () => {
  it('fails on an error and ignores other levels', () => {
    expect(consoleFailure({ type: 'error', text: 'boom' }, ok)).toContain('boom')
    expect(consoleFailure({ type: 'warning', text: 'meh' }, ok)).toBeUndefined()
    expect(consoleFailure({ type: 'log', text: 'hi' }, ok)).toBeUndefined()
  })

  it('allows only the intended 404 document load', () => {
    const own = {
      type: 'error',
      text: 'Failed to load resource: the server responded with a status of 404 (Not Found)',
      location: 'http://x/nope',
    }
    expect(consoleFailure(own, notFound)).toBeUndefined()
    expect(consoleFailure({ ...own, location: 'http://x/img.webp' }, notFound)).toBeDefined()
    // A 404 console error on a page that should be 200 is a real failure.
    expect(consoleFailure({ ...own, location: 'http://x/about' }, ok)).toBeDefined()
  })
})

describe('responseFailure', () => {
  it('passes 2xx and 3xx', () => {
    expect(
      responseFailure({ url: 'http://x/a.css', status: 200, isDocument: false }, ok),
    ).toBeUndefined()
    expect(
      responseFailure({ url: 'http://x/old', status: 301, isDocument: true }, ok),
    ).toBeUndefined()
  })

  it('fails any 4xx or 5xx subresource, even on the 404 page', () => {
    expect(
      responseFailure({ url: 'http://x/a.webp', status: 404, isDocument: false }, ok),
    ).toContain('404')
    expect(
      responseFailure({ url: 'http://x/a.webp', status: 404, isDocument: false }, notFound),
    ).toBeDefined()
    expect(
      responseFailure({ url: 'http://x/a.js', status: 500, isDocument: false }, ok),
    ).toBeDefined()
  })

  it('allows the document itself only with the expected status', () => {
    expect(
      responseFailure({ url: 'http://x/nope', status: 404, isDocument: true }, notFound),
    ).toBeUndefined()
    expect(
      responseFailure({ url: 'http://x/about', status: 404, isDocument: true }, ok),
    ).toBeDefined()
    expect(
      responseFailure({ url: 'http://x/nope', status: 500, isDocument: true }, notFound),
    ).toBeDefined()
  })
})

describe('requestFailure', () => {
  it('names the url and reason', () => {
    expect(requestFailure({ url: 'http://x/a', reason: 'net::ERR_FAILED' })).toContain('ERR_FAILED')
  })

  it('ignores the CSP block of scripts only when JS is disabled', () => {
    const blocked = { url: 'http://x/a.js', reason: 'csp' }
    expect(requestFailure({ ...blocked, jsEnabled: false })).toBeUndefined()
    expect(requestFailure({ ...blocked, jsEnabled: true })).toBeDefined()
  })

  it('ignores a cancelled RSC prefetch but not other aborted requests', () => {
    expect(
      requestFailure({ url: 'http://x/about?_rsc=abc', reason: 'net::ERR_ABORTED' }),
    ).toBeUndefined()
    expect(requestFailure({ url: 'http://x/a.webp', reason: 'net::ERR_ABORTED' })).toBeDefined()
  })
})
