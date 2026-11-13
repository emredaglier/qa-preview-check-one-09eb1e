'use client'

import { mountGlow, type GlowMount } from '@house/motion/glow'
import { useIdle, useReducedMotion } from '@house/motion/react'
import { useEffect, useRef, type ReactNode } from 'react'

/**
 * Wraps `children` and, when WebGL2 works, draws the example glow behind them. Without WebGL2 or
 * after a failure the children are all there is, so the content never depends on the effect.
 */
export function GlowBackdrop({ children, className }: { children: ReactNode; className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const glowRef = useRef<GlowMount | null>(null)
  const idleRef = useRef(false)
  const reducedMotion = useReducedMotion()
  const idle = useIdle()

  // A fresh canvas and stage on every run, disposed in the cleanup (the engine contract).
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const glow = mountGlow(host, { reducedMotion, canvasAttributes: { 'data-perf': 'glow' } })
    glow.setActive(!idleRef.current)
    glowRef.current = glow
    return () => {
      glow.dispose()
      glowRef.current = null
    }
  }, [reducedMotion])

  // A decorative loop stops while the visitor is idle.
  useEffect(() => {
    idleRef.current = idle
    glowRef.current?.setActive(!idle)
  }, [idle])

  return (
    <div ref={hostRef} className={className}>
      {children}
    </div>
  )
}
