// The listener for motion faults (ADR-0011, packages/motion README "The engine contract", rule 4).
// Pure and free of any SDK, so tests stay cheap. A project fills in `reportFault`.
import { MOTION_FAULT_EVENT } from '@house/motion'

export type FaultSink = (kind: string, detail: string | undefined) => void

/**
 * Where a motion fault goes. The starter only logs it; a project sends it to its error monitor
 * here (Sentry, ADR-0011), with no other change.
 */
export const reportFault: FaultSink = (kind, detail) => {
  console.warn(`[motion fault] ${kind}${detail ? `: ${detail}` : ''}`)
}

const MAX_REPORTED_FAULTS = 20

/**
 * Forwards each distinct kind and detail once per page load (a broken frame loop would repeat it
 * forever), up to a cap so a fault with ever-changing detail cannot flood the sink. Returns the
 * function that stops listening.
 */
export function startMotionFaultReporting(target: EventTarget, sink: FaultSink): () => void {
  const reported = new Set<string>()
  const listener = (event: Event) => {
    const data = (event as CustomEvent<unknown>).detail
    if (typeof data !== 'object' || data === null) return
    const { kind, detail } = data as { kind?: unknown; detail?: unknown }
    if (typeof kind !== 'string') return
    const text = typeof detail === 'string' ? detail : undefined
    const key = `${kind}\u0000${text ?? ''}`
    if (reported.has(key) || reported.size >= MAX_REPORTED_FAULTS) return
    reported.add(key)
    sink(kind, text)
  }
  target.addEventListener(MOTION_FAULT_EVENT, listener)
  return () => target.removeEventListener(MOTION_FAULT_EVENT, listener)
}
