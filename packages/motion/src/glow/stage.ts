import { readCssColor, type Rgb } from '../color'
import { reportMotionFault } from '../fault'
import { canvasSize } from './math'
import { FRAGMENT_SOURCE, VERTEX_SOURCE } from './shader'

/** What to draw, in device px with the origin at the top left. */
export type GlowState = {
  x: number
  y: number
  radius: number
  /** 0..1 */
  strength: number
}

export type GlowStageOptions = {
  /** CSS custom property holding the glow colour. */
  colorVar?: string
  /** Device pixels per CSS pixel, at most. */
  maxDpr?: number
}

export type GlowStage = {
  /** False without WebGL2, after a failure, and while the context is lost; true again once restored. */
  readonly ok: boolean
  draw(state: GlowState): void
  /** Re-reads the canvas size and device pixel ratio, then redraws the last state. */
  resize(): void
  /** Re-reads the colour from CSS (once per sequence, not per frame). */
  setColor(): void
  dispose(): void
}

export const MAX_GLOW_DPR = 1.5
const FALLBACK_COLOR: Rgb = [0.5, 0.5, 0.5]
const FAULT_DETAIL = 'glow'

const inert = (): GlowStage => ({
  ok: false,
  draw() {},
  resize() {},
  setColor() {},
  dispose() {},
})

const compile = (gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null => {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
  gl.deleteShader(shader)
  return null
}

/** Hands the GPU context back now: browsers allow only a handful of live ones. */
const releaseContext = (gl: WebGL2RenderingContext) =>
  gl.getExtension('WEBGL_lose_context')?.loseContext?.()

const link = (gl: WebGL2RenderingContext): WebGLProgram | null => {
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SOURCE)
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE)
  const program = vs && fs ? gl.createProgram() : null
  if (program && vs && fs) {
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
  }
  // The shaders are only needed until the program is linked, whether or not it linked.
  if (vs) gl.deleteShader(vs)
  if (fs) gl.deleteShader(fs)
  if (program && gl.getProgramParameter(program, gl.LINK_STATUS)) return program
  if (program) gl.deleteProgram(program)
  return null
}

/** Everything a context owns: gone with a lost context, built again for a restored one. */
const build = (gl: WebGL2RenderingContext) => {
  const program = link(gl)
  if (!program) return null
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  gl.useProgram(program)
  const position = gl.getAttribLocation(program, 'aPos')
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  const uniform = (name: string) => gl.getUniformLocation(program, name)
  return {
    program,
    buffer,
    uRes: uniform('uRes'),
    uCenter: uniform('uCenter'),
    uRadius: uniform('uRadius'),
    uStrength: uniform('uStrength'),
    uColor: uniform('uColor'),
  }
}

/**
 * The example WebGL2 effect: one soft glow over the page. It follows the engine contract in the
 * package README:
 *
 * - `ok` is false, and every method a no-op, when WebGL2 is missing, a shader does not compile or
 *   link (that one also reports a `gl-error` fault) or the context is lost (`gl-context-lost`).
 * - After `webglcontextrestored` it builds its GPU resources again and redraws the last state.
 * - It owns the canvas it is given: make a fresh canvas and a fresh stage on every effect run.
 */
export const createGlowStage = (
  canvas: HTMLCanvasElement,
  options: GlowStageOptions = {},
): GlowStage => {
  const { colorVar = '--glow-color', maxDpr = MAX_GLOW_DPR } = options
  let gl: WebGL2RenderingContext | null = null
  try {
    gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
    })
  } catch {
    gl = null
  }
  // No WebGL2 at all is an ordinary capability gap, not a fault: the page just shows its HTML.
  if (!gl) return inert()
  const first = build(gl)
  if (!first) {
    reportMotionFault('gl-error', FAULT_DETAIL)
    releaseContext(gl)
    return inert()
  }
  const context = gl
  let gpu = first

  let ok = true
  let disposed = false
  let last: GlowState | null = null
  let color: Rgb = FALLBACK_COLOR

  const draw = (state: GlowState) => {
    last = state
    if (!ok || disposed) return
    context.useProgram(gpu.program)
    context.uniform2f(gpu.uRes, canvas.width, canvas.height)
    context.uniform2f(gpu.uCenter, state.x, state.y)
    context.uniform1f(gpu.uRadius, Math.max(1, state.radius))
    context.uniform1f(gpu.uStrength, state.strength)
    context.uniform3f(gpu.uColor, color[0], color[1], color[2])
    // Transparent first, so the previous frame does not show through the soft edge.
    context.clear(context.COLOR_BUFFER_BIT)
    context.drawArrays(context.TRIANGLE_STRIP, 0, 4)
  }

  const resize = () => {
    if (!ok || disposed) return
    const size = canvasSize(
      canvas.clientWidth || 1,
      canvas.clientHeight || 1,
      typeof window === 'undefined' ? 1 : window.devicePixelRatio,
      maxDpr,
    )
    canvas.width = size.width
    canvas.height = size.height
    context.viewport(0, 0, canvas.width, canvas.height)
    if (last) draw(last)
  }

  const setColor = () => {
    color = readCssColor(colorVar, canvas, color)
    if (last) draw(last)
  }

  const onLost = (event: Event) => {
    // Without this the browser never restores the context.
    event.preventDefault()
    if (!ok) return
    ok = false
    reportMotionFault('gl-context-lost', FAULT_DETAIL)
  }
  const onRestored = () => {
    if (disposed) return
    const rebuilt = build(context)
    if (!rebuilt) {
      reportMotionFault('gl-error', FAULT_DETAIL)
      return
    }
    gpu = rebuilt
    ok = true
    // The layout may have changed while the context was gone: size from it now, not from the
    // width and height the canvas had before, then redraw the last state.
    resize()
  }
  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webglcontextrestored', onRestored)

  setColor()
  resize()

  return {
    get ok() {
      return ok
    },
    draw,
    resize,
    setColor,
    dispose() {
      if (disposed) return
      disposed = true
      ok = false
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      context.deleteBuffer(gpu.buffer)
      context.deleteProgram(gpu.program)
      releaseContext(context)
    },
  }
}
