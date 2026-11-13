import { describe, expect, it } from 'vitest'
import { SOCKET_SUITES, canListenLocally, socketSuitesToSkip } from './local-sockets'

describe('socketSuitesToSkip', () => {
  it('skips nothing where local sockets work', () => {
    expect(socketSuitesToSkip(true, false)).toEqual([])
    expect(socketSuitesToSkip(true, true)).toEqual([])
  })

  it('skips the socket suites where they do not, when not on CI', () => {
    expect(socketSuitesToSkip(false, false)).toEqual(SOCKET_SUITES)
  })

  it('fails on CI instead of skipping', () => {
    expect(() => socketSuitesToSkip(false, true)).toThrow(/CI/)
  })
})

describe('canListenLocally', () => {
  it('is false when the machine cannot listen on the address', () => {
    // A documentation-only address that no interface owns, so `listen` fails everywhere.
    expect(canListenLocally('203.0.113.1')).toBe(false)
  })
})
