import { cappedTick, addTick, removeTick } from '../ticker'
import { followPoint, toCanvasPoint, type Point } from './math'
import { createGlowStage, type GlowStageOptions } from './stage'

export type GlowMountOptions = GlowStageOptions & {
  /** Draw one still frame: no loop, no pointer following. */
  reducedMotion?: boolean
  /** Attributes for the canvas (a project's perf hook, a test id). */
  canvasAttributes?: Readonly<Record<string, string>>
  /** How fast the glow follows the pointer, per second. */
  followRate?: number
  /** The loop's frame-rate cap. */
  hz?: number
}

export type GlowMount = {
  /** False when there is no WebGL2, the effect failed or the context is lost. The host's own HTML is then all there is. */
  readonly ok: boolean
  /** Runs or pauses the loop. Pause it while the visitor is idle. */
  setActive(active: boolean): void
  /** Re-reads the colour from CSS, e.g. after a theme change. */
  setColor(): void
  /** Removes the canvas, the listeners and the loop. Safe to call twice. */
  dispose(): void
}

const RADIUS_OF_LONGER_SIDE = 0.35
const STRENGTH = 0.5
const MAX_STEP_SECONDS = 0.1

const inert = (): GlowMount => ({
  ok: false,
  setActive() {},
  setColor() {},
  dispose() {},
})

/**
 * Puts the example effect into `host`, behind the host's own content: the canvas is the host's
 * first child and positioned, so content that must paint over it needs `position: relative`. Call it from an effect
 * and call `dispose` from the effect's cleanup: every run gets a fresh canvas and a fresh stage,
 * because a disposed or lost WebGL context cannot be reused (and React Strict Mode runs effects
 * twice). Without WebGL2, or when the effect fails, the host is left exactly as it was.
 */
export const mountGlow = (host: HTMLElement, options: GlowMountOptions = {}): GlowMount => {
  const { reducedMotion = false, canvasAttributes = {}, followRate = 8, hz = 60 } = options
  const canvas = document.createElement('canvas')
  canvas.setAttribute('aria-hidden', 'true')
  for (const [name, value] of Object.entries(canvasAttributes)) canvas.setAttribute(name, value)
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
  })
  // In the page before the stage is made: the stage sizes itself from the layout.
  host.prepend(canvas)
  const stage = createGlowStage(canvas, options)
  if (!stage.ok) {
    canvas.remove()
    return inert()
  }

  const centre = (): Point => ({ x: canvas.width / 2, y: canvas.height / 2 })
  let current = centre()
  let target = current
  let disposed = false
  let active = false

  const radius = () => Math.max(canvas.width, canvas.height) * RADIUS_OF_LONGER_SIDE
  const draw = () =>
    stage.draw({ x: current.x, y: current.y, radius: radius(), strength: STRENGTH })

  const step = cappedTick((_time, deltaMs) => {
    const next = followPoint(
      current,
      target,
      Math.min(deltaMs / 1000, MAX_STEP_SECONDS),
      followRate,
    )
    if (next.x === current.x && next.y === current.y) return
    current = next
    draw()
  }, hz)

  const onPointerMove = (event: PointerEvent) => {
    target = toCanvasPoint(event.clientX, event.clientY, canvas.getBoundingClientRect(), canvas)
  }

  // Keep the glow where it was, in proportion, when the canvas changes size.
  const observer =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          const before = { width: canvas.width, height: canvas.height }
          stage.resize()
          const scale = (value: number, from: number, to: number) =>
            from > 0 ? (value / from) * to : value
          current = {
            x: scale(current.x, before.width, canvas.width),
            y: scale(current.y, before.height, canvas.height),
          }
          target = {
            x: scale(target.x, before.width, canvas.width),
            y: scale(target.y, before.height, canvas.height),
          }
          draw()
        })
  observer?.observe(host)

  const setActive = (next: boolean) => {
    if (disposed || reducedMotion || next === active) return
    active = next
    if (next) addTick(step)
    else removeTick(step)
  }

  draw()
  if (!reducedMotion) {
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    setActive(true)
  }

  return {
    get ok() {
      return stage.ok
    },
    setActive,
    setColor: () => stage.setColor(),
    dispose() {
      if (disposed) return
      setActive(false)
      disposed = true
      window.removeEventListener('pointermove', onPointerMove)
      observer?.disconnect()
      stage.dispose()
      canvas.remove()
    },
  }
}
