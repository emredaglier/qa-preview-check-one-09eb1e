// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

import { MOTION_FAULT_EVENT, reportMotionFault } from './fault'

describe('reportMotionFault', () => {
  it('dispatches the fault event with kind and detail', () => {
    const seen = vi.fn()
    window.addEventListener(MOTION_FAULT_EVENT, seen)
    reportMotionFault('gl-context-lost', 'example-effect')
    window.removeEventListener(MOTION_FAULT_EVENT, seen)
    expect(seen).toHaveBeenCalledTimes(1)
    expect((seen.mock.calls[0]![0] as CustomEvent).detail).toEqual({
      kind: 'gl-context-lost',
      detail: 'example-effect',
    })
  })
})
