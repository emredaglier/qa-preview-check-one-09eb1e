import { describe, expect, it, vi } from 'vitest'

import { siteConfigOptionsFromEnv } from './index'
import { notifyRevalidate } from './revalidate'
import { TAG_PATTERN } from './tags'

const log = () => ({ error: vi.fn() })

describe('notifyRevalidate', () => {
  it('POSTs the tags with the secret to every URL', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    const ok = await notifyRevalidate(
      {
        urls: ['http://web:3000/internal/revalidate', 'http://preview:3000/internal/revalidate'],
        secret: 's3',
      },
      ['global:site'],
      log(),
      fetchImpl,
    )
    expect(ok).toBe(2)
    expect(calls.map((c) => c.url)).toEqual([
      'http://web:3000/internal/revalidate',
      'http://preview:3000/internal/revalidate',
    ])
    expect(calls[0]?.init.method).toBe('POST')
    expect((calls[0]?.init.headers as Record<string, string>)['x-revalidate-secret']).toBe('s3')
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ tags: ['global:site'] })
  })

  it('logs failures and bad statuses without throwing, and keeps going', async () => {
    const logger = log()
    const fetchImpl = (async (url: string) => {
      if (url.includes('dead')) throw new Error('connect ECONNREFUSED')
      if (url.includes('bad')) return new Response('no', { status: 401 })
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    const ok = await notifyRevalidate(
      { urls: ['http://dead/x', 'http://bad/x', 'http://good/x'], secret: 's' },
      ['global:site'],
      logger,
      fetchImpl,
    )
    expect(ok).toBe(1)
    expect(logger.error).toHaveBeenCalledTimes(2)
  })

  it('gives up on a hung URL after the timeout', async () => {
    const logger = log()
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })) as unknown as typeof fetch
    const started = Date.now()
    const ok = await notifyRevalidate(
      { urls: ['http://hung/x'], secret: 's', timeoutMs: 50 },
      ['global:site'],
      logger,
      fetchImpl,
    )
    expect(ok).toBe(0)
    expect(Date.now() - started).toBeLessThan(1500)
    expect(logger.error).toHaveBeenCalledOnce()
  })
})

describe('revalidate env', () => {
  const base = { DATABASE_PATH: 'x.db', PAYLOAD_SECRET: 's' }
  it('reads the URL list and secret', () => {
    expect(
      siteConfigOptionsFromEnv('cms', {
        ...base,
        REVALIDATE_URLS: 'http://web:3000/a, http://preview:3000/a',
        REVALIDATE_SECRET: 'r',
      }).revalidate,
    ).toEqual({ urls: ['http://web:3000/a', 'http://preview:3000/a'], secret: 'r' })
  })
  it('is off without URLs, and refuses URLs without a secret', () => {
    expect(siteConfigOptionsFromEnv('cms', base).revalidate).toBeUndefined()
    expect(() =>
      siteConfigOptionsFromEnv('cms', { ...base, REVALIDATE_URLS: 'http://a/x' }),
    ).toThrow(/REVALIDATE_SECRET/)
  })
})

describe('TAG_PATTERN', () => {
  it('accepts our tags and rejects others', () => {
    for (const ok of ['global:site', 'collection:pages', 'doc:pages:12']) {
      expect(TAG_PATTERN.test(ok)).toBe(true)
    }
    for (const bad of ['', 'site', 'global:', 'x:y', 'global:Site', 'doc:pages', 'global:a b']) {
      expect(TAG_PATTERN.test(bad)).toBe(false)
    }
  })
})
