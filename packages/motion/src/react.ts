import { useEffect, useState } from 'react'
import { prefersReducedMotion } from './capabilities'
import { createIdleWatcher, idleTimeoutMs } from './idle'
import { addTick, removeTick, type Tick } from './ticker'

let shared: ReturnType<typeof createIdleWatcher> | undefined

/** The app-wide idle watcher; the timeout is read when the timer is armed, so it follows the route. */
const sharedWatcher = () =>
  (shared ??= createIdleWatcher({ timeoutMs: () => idleTimeoutMs(window.location.pathname) }))

/** True while the visitor is idle (mouse devices only; always false elsewhere). */
export const useIdle = (): boolean => {
  const [idle, setIdle] = useState(false)
  useEffect(() => sharedWatcher().watch(setIdle), [])
  return idle
}

/** Runs `fn` on the safe ticker while mounted. */
export const useTick = (fn: Tick): void => {
  useEffect(() => {
    addTick(fn)
    return () => removeTick(fn)
  }, [fn])
}

/** `prefers-reduced-motion: reduce`, read after mount (false during SSR and hydration). */
export const useReducedMotion = (): boolean => {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(prefersReducedMotion())
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return reduced
}
