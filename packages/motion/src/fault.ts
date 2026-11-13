/** The event every motion piece reports a silent failure through. Observability listens for it. */
export const MOTION_FAULT_EVENT = 'house:motion-fault'

export type MotionFaultKind = 'ticker-callback-removed' | 'gl-context-lost' | 'gl-error'

/** Tells observability that a motion piece broke silently. Never throws. */
export const reportMotionFault = (kind: MotionFaultKind, detail: string): void => {
  try {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent(MOTION_FAULT_EVENT, { detail: { kind, detail } }))
  } catch {
    // Reporting must never break the animation it reports on.
  }
}
