import { describe, expect, it } from 'vitest'

import { siteConfigOptionsFromEnv } from './index'

describe('siteConfigOptionsFromEnv', () => {
  it('requires the database path and secret', () => {
    expect(() => siteConfigOptionsFromEnv('cms', {})).toThrow(/DATABASE_PATH/)
    expect(() => siteConfigOptionsFromEnv('cms', { DATABASE_PATH: 'x.db' })).toThrow(
      /PAYLOAD_SECRET/,
    )
  })

  it('reads the optional values', () => {
    expect(
      siteConfigOptionsFromEnv('web', {
        DATABASE_PATH: 'x.db',
        PAYLOAD_SECRET: 's',
        PAYLOAD_DB_PUSH: 'false',
        CMS_ORIGINS: 'https://a.ts.net, https://b.ts.net',
      }),
    ).toEqual({
      role: 'web',
      databasePath: 'x.db',
      secret: 's',
      push: false,
      origins: ['https://a.ts.net', 'https://b.ts.net'],
    })
  })

  it('refuses revalidation URLs without a secret', () => {
    expect(() =>
      siteConfigOptionsFromEnv('cms', {
        DATABASE_PATH: 'x.db',
        PAYLOAD_SECRET: 's',
        REVALIDATE_URLS: 'http://web/internal/revalidate',
      }),
    ).toThrow(/REVALIDATE_SECRET/)
  })
})

describe('CMS_ORIGINS', () => {
  const base = { DATABASE_PATH: 'x.db', PAYLOAD_SECRET: 's' }

  it('is required for cms in production, because an empty list turns CSRF checks off', () => {
    expect(() => siteConfigOptionsFromEnv('cms', { ...base, NODE_ENV: 'production' })).toThrow(
      /CMS_ORIGINS/,
    )
    expect(() =>
      siteConfigOptionsFromEnv('cms', { ...base, NODE_ENV: 'production', CMS_ORIGINS: ' , ' }),
    ).toThrow(/CMS_ORIGINS/)
    expect(
      siteConfigOptionsFromEnv('cms', {
        ...base,
        NODE_ENV: 'production',
        CMS_ORIGINS: 'https://box.ts.net',
      }).origins,
    ).toEqual(['https://box.ts.net'])
  })

  it('stays optional in local dev and tests, for `next build`, and for web', () => {
    for (const env of [
      { ...base, NODE_ENV: 'development' },
      { ...base, NODE_ENV: 'test' },
      { ...base },
      { ...base, NODE_ENV: 'production', NEXT_PHASE: 'phase-production-build' },
    ]) {
      expect(siteConfigOptionsFromEnv('cms', env).origins).toEqual([])
    }
    expect(siteConfigOptionsFromEnv('web', { ...base, NODE_ENV: 'production' }).origins).toEqual([])
  })
})
