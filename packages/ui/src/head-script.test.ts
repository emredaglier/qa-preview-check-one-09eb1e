import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

import { HEAD_SCRIPT } from './head-script'

describe('head script', () => {
  it('marks the page as JS-enabled before first paint', () => {
    const attributes: Record<string, string> = {}
    runInNewContext(HEAD_SCRIPT, {
      document: {
        documentElement: { setAttribute: (k: string, v: string) => (attributes[k] = v) },
      },
    })
    expect(attributes).toEqual({ 'data-js': '' })
  })

  it('stays tiny', () => {
    expect(HEAD_SCRIPT.length).toBeLessThan(500)
  })
})
