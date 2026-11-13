import { expect, it } from 'vitest'

import config from '../next.config'

it('sends no Client Hints headers: Payload adds them for its admin, and Chrome re-requests the first page for Critical-CH', async () => {
  const rules = (await config.headers?.()) ?? []
  const names = rules.flatMap((rule) => rule.headers.map(({ key, value }) => `${key}: ${value}`))
  expect(names.filter((line) => /accept-ch|critical-ch|sec-ch-/i.test(line))).toEqual([])
})
