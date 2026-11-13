const media = (query: string): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false

/** `prefers-reduced-motion: reduce`. False on the server. */
export const prefersReducedMotion = (): boolean => media('(prefers-reduced-motion: reduce)')

/** A mouse-like pointer: `(hover: hover) and (pointer: fine)`. False on the server. */
export const hasFinePointer = (): boolean => media('(hover: hover) and (pointer: fine)')

let webgl2: boolean | undefined

/** Whether a WebGL2 context can be created. Probed once. False on the server. */
export const hasWebGL2 = (): boolean => {
  if (webgl2 !== undefined) return webgl2
  if (typeof document === 'undefined') return false
  try {
    webgl2 = !!document.createElement('canvas').getContext('webgl2')
  } catch {
    webgl2 = false
  }
  return webgl2
}

/** Test hook: forget the cached WebGL2 probe. */
export const resetWebGL2Probe = (): void => {
  webgl2 = undefined
}

/** Whether `document.startViewTransition` exists. False on the server. */
export const supportsViewTransitions = (): boolean =>
  typeof document !== 'undefined' && typeof document.startViewTransition === 'function'
