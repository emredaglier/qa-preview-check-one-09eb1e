import { describe, expect, it } from 'vitest'

import { runIdle } from './idle.ts'

describe('runIdle', () => {
  it('is skipped with a notice, without opening a browser, when no idle page is configured', async () => {
    const result = await runIdle('http://localhost:0', null)
    expect(result).toMatchObject({ status: 'skipped' })
    expect(result.status === 'skipped' && result.reason).toContain('IDLE_PATH')
  })
})
