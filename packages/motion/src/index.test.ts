import { expect, it } from 'vitest'
import * as motion from './index'
import * as react from './react'

// Runs in the default node environment: no window, no document.
it('imports on the server without throwing, and its helpers are inert', () => {
  expect(motion.prefersReducedMotion()).toBe(false)
  expect(motion.hasFinePointer()).toBe(false)
  expect(motion.hasWebGL2()).toBe(false)
  expect(motion.supportsViewTransitions()).toBe(false)
  expect(motion.readEase('--x')(0.5)).toBe(0.5)
  expect(motion.readCssColor('--x')).toEqual([0, 0, 0])
  expect(() => motion.setHtmlFlag('saver', true)).not.toThrow()
  expect(() => motion.reportMotionFault('gl-error', 'x')).not.toThrow()
  expect(typeof react.useIdle).toBe('function')
})
