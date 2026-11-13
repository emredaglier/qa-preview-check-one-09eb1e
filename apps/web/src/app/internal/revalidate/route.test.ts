import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { revalidateTag } = vi.hoisted(() => ({ revalidateTag: vi.fn() }))
vi.mock('next/cache', () => ({ revalidateTag }))

import { POST } from './route'

const call = (headers: Record<string, string>, body: unknown) =>
  POST(
    new Request('http://web/internal/revalidate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )

beforeEach(() => {
  process.env.REVALIDATE_SECRET = 'right-secret'
  revalidateTag.mockClear()
})
afterEach(() => {
  delete process.env.REVALIDATE_SECRET
})

describe('POST /internal/revalidate', () => {
  it('answers 401 to a wrong or missing secret and revalidates nothing', async () => {
    expect((await call({ 'x-revalidate-secret': 'wrong' }, { tags: ['global:site'] })).status).toBe(
      401,
    )
    expect((await call({}, { tags: ['global:site'] })).status).toBe(401)
    expect(revalidateTag).not.toHaveBeenCalled()
  })

  it('answers 401 to everything when no secret is configured', async () => {
    delete process.env.REVALIDATE_SECRET
    expect((await call({ 'x-revalidate-secret': '' }, { tags: ['global:site'] })).status).toBe(401)
    expect(
      (await call({ 'x-revalidate-secret': 'undefined' }, { tags: ['global:site'] })).status,
    ).toBe(401)
  })

  it('revalidates known tags immediately (expire 0)', async () => {
    const response = await call(
      { 'x-revalidate-secret': 'right-secret' },
      {
        tags: ['global:site', 'doc:pages:3'],
      },
    )
    expect(response.status).toBe(200)
    expect(revalidateTag).toHaveBeenCalledWith('global:site', { expire: 0 })
    expect(revalidateTag).toHaveBeenCalledWith('doc:pages:3', { expire: 0 })
  })

  it('rejects malformed bodies and tags it does not know', async () => {
    const headers = { 'x-revalidate-secret': 'right-secret' }
    expect((await call(headers, 'not json')).status).toBe(400)
    expect((await call(headers, { tags: [] })).status).toBe(400)
    expect((await call(headers, { tags: ['anything'] })).status).toBe(400)
    expect((await call(headers, { tags: [42] })).status).toBe(400)
    expect(revalidateTag).not.toHaveBeenCalled()
  })
})
