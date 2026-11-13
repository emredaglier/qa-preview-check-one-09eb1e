// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MOTION_FAULT_EVENT } from '../fault'
import { createGlowStage, type GlowState } from './stage'

/** A WebGL2 stand-in: every method is a no-op, compile/link report success, constants are numbers. */
const fakeGl = () => {
  const calls: { name: string; args: unknown[] }[] = []
  const flags = { compiles: true, links: true }
  const loseContext = vi.fn()
  const gl = new Proxy(
    {},
    {
      get: (_target, name: string) => {
        if (name === 'getShaderParameter') return () => flags.compiles
        if (name === 'getProgramParameter') return () => flags.links
        if (name === 'getExtension') return () => ({ loseContext })
        if (/^[A-Z0-9_]+$/.test(name)) return 1
        return (...args: unknown[]) => {
          calls.push({ name, args })
          return {}
        }
      },
    },
  )
  return { gl, calls, flags, loseContext }
}

const canvasWith = (gl: unknown) => {
  const canvas = document.createElement('canvas')
  canvas.getContext = (() => gl) as unknown as typeof canvas.getContext
  return canvas
}

const state: GlowState = { x: 10, y: 20, radius: 50, strength: 1 }

const faultsDuring = (run: () => void) => {
  const faults: unknown[] = []
  const listen = (event: Event) => faults.push((event as CustomEvent).detail)
  window.addEventListener(MOTION_FAULT_EVENT, listen)
  run()
  window.removeEventListener(MOTION_FAULT_EVENT, listen)
  return faults
}

afterEach(() => vi.restoreAllMocks())

describe('createGlowStage: engine contract', () => {
  it('is not ok without WebGL2, every call is a safe no-op, and it is not a fault', () => {
    const canvas = document.createElement('canvas')
    canvas.getContext = (() => null) as unknown as typeof canvas.getContext
    const faults = faultsDuring(() => {
      const stage = createGlowStage(canvas)
      expect(stage.ok).toBe(false)
      expect(() => {
        stage.draw(state)
        stage.resize()
        stage.setColor()
        stage.dispose()
      }).not.toThrow()
    })
    expect(faults).toEqual([])
  })

  it('is not ok when getContext throws', () => {
    const canvas = document.createElement('canvas')
    canvas.getContext = (() => {
      throw new Error('blocked')
    }) as unknown as typeof canvas.getContext
    expect(createGlowStage(canvas).ok).toBe(false)
  })

  it('is not ok and reports gl-error when the shaders do not compile', () => {
    const { gl, flags } = fakeGl()
    flags.compiles = false
    const faults = faultsDuring(() => {
      expect(createGlowStage(canvasWith(gl)).ok).toBe(false)
    })
    expect(faults).toEqual([{ kind: 'gl-error', detail: 'glow' }])
  })

  it('is not ok and reports gl-error when the program does not link', () => {
    const { gl, flags } = fakeGl()
    flags.links = false
    const faults = faultsDuring(() => {
      expect(createGlowStage(canvasWith(gl)).ok).toBe(false)
    })
    expect(faults).toEqual([{ kind: 'gl-error', detail: 'glow' }])
  })

  it.each([
    ['compile', 'compiles'],
    ['link', 'links'],
  ] as const)('releases the GPU context and every shader when the first %s fails', (_, flag) => {
    const { gl, calls, flags, loseContext } = fakeGl()
    flags[flag] = false
    createGlowStage(canvasWith(gl))
    expect(loseContext).toHaveBeenCalledTimes(1)
    const count = (name: string) => calls.filter((c) => c.name === name).length
    expect(count('deleteShader')).toBe(count('createShader'))
    if (flag === 'links') expect(count('deleteProgram')).toBe(count('createProgram'))
  })

  it('deletes the shaders once the program is linked', () => {
    const { gl, calls } = fakeGl()
    createGlowStage(canvasWith(gl))
    expect(calls.filter((c) => c.name === 'deleteShader')).toHaveLength(2)
  })

  it('draws one full-screen triangle strip per draw()', () => {
    const { gl, calls } = fakeGl()
    const stage = createGlowStage(canvasWith(gl))
    expect(stage.ok).toBe(true)
    const before = calls.filter((c) => c.name === 'drawArrays').length
    stage.draw(state)
    const draws = calls.filter((c) => c.name === 'drawArrays')
    expect(draws.length - before).toBe(1)
    expect(draws.at(-1)?.args).toEqual([1, 0, 4])
  })

  it('on context loss: ok turns false, one fault event fires, drawing stops', () => {
    const { gl, calls } = fakeGl()
    const canvas = canvasWith(gl)
    const stage = createGlowStage(canvas)
    const faults = faultsDuring(() => {
      const event = new Event('webglcontextlost', { cancelable: true })
      canvas.dispatchEvent(event)
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
      expect(event.defaultPrevented).toBe(true)
    })
    expect(stage.ok).toBe(false)
    expect(faults).toEqual([{ kind: 'gl-context-lost', detail: 'glow' }])
    const before = calls.length
    stage.draw(state)
    expect(calls).toHaveLength(before)
  })

  it('rebuilds itself after the context is restored, and redraws the last state', () => {
    const { gl, calls } = fakeGl()
    const canvas = canvasWith(gl)
    const stage = createGlowStage(canvas)
    stage.draw(state)
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    stage.draw({ ...state, x: 99 })
    const before = calls.length
    canvas.dispatchEvent(new Event('webglcontextrestored'))
    expect(stage.ok).toBe(true)
    const names = calls.slice(before).map((c) => c.name)
    expect(names).toEqual(expect.arrayContaining(['createProgram', 'createBuffer', 'linkProgram']))
    // The state asked for while the context was gone is on screen again.
    expect(names.at(-1)).toBe('drawArrays')
    const centre = calls.slice(before).find((c) => c.name === 'uniform2f' && c.args[1] === 99)
    expect(centre).toBeDefined()
  })

  it('sizes to the canvas as it is now, not as it was, when the context is restored', () => {
    const { gl } = fakeGl()
    const canvas = canvasWith(gl)
    let width = 800
    Object.defineProperty(canvas, 'clientWidth', { get: () => width })
    Object.defineProperty(canvas, 'clientHeight', { value: 400 })
    const stage = createGlowStage(canvas)
    expect(canvas.width).toBe(800)
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    width = 300
    canvas.dispatchEvent(new Event('webglcontextrestored'))
    expect(stage.ok).toBe(true)
    expect(canvas.width).toBe(300)
    expect(canvas.height).toBe(400)
  })

  it('stays not ok and reports gl-error when the restored context cannot rebuild', () => {
    const { gl, flags } = fakeGl()
    const canvas = canvasWith(gl)
    const stage = createGlowStage(canvas)
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    flags.links = false
    const faults = faultsDuring(() => canvas.dispatchEvent(new Event('webglcontextrestored')))
    expect(stage.ok).toBe(false)
    expect(faults).toEqual([{ kind: 'gl-error', detail: 'glow' }])
  })

  it('reports a second loss after a restore', () => {
    const { gl } = fakeGl()
    const canvas = canvasWith(gl)
    const stage = createGlowStage(canvas)
    const faults = faultsDuring(() => {
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
      canvas.dispatchEvent(new Event('webglcontextrestored'))
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    })
    expect(faults).toHaveLength(2)
    expect(stage.ok).toBe(false)
  })

  it('a disposed stage is inert, frees its GPU resources and ignores a restore', () => {
    const { gl, calls } = fakeGl()
    const canvas = canvasWith(gl)
    const stage = createGlowStage(canvas)
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    stage.dispose()
    expect(calls.map((c) => c.name)).toEqual(
      expect.arrayContaining(['deleteProgram', 'deleteBuffer']),
    )
    canvas.dispatchEvent(new Event('webglcontextrestored'))
    expect(stage.ok).toBe(false)
    expect(() => stage.dispose()).not.toThrow()
  })
})
