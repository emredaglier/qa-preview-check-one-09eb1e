// The WebGL DOM-fallback check against the example effect (smoke/webgl.ts): with no WebGL, and with
// shaders that do not build, the page keeps its plain HTML, loses its canvas and logs no error. The
// engine contract (packages/motion/README.md) also says what is reported: missing WebGL2 is a
// capability gap and reports nothing; a shader that fails to build reports a `gl-error` fault.
//
// Not here: how the effect looks or moves, and a context lost mid-session (both need a real GPU;
// the owner checks them by hand, and `pnpm perf` measures the frames).
import { expect, test } from './fixtures.ts'
import {
  EFFECT_PAGES,
  domFallbackProblems,
  effectTried,
  faultsOf,
  recordFaults,
  withBrokenShaders,
  withoutWebGL,
} from './webgl.ts'

for (const effect of EFFECT_PAGES) {
  test.describe(`${effect.route} without its effect`, () => {
    test('with no WebGL the page is complete, and nothing is reported', async ({
      context,
      page,
      visit,
    }) => {
      await recordFaults(context)
      await withoutWebGL(context)
      const failures = await visit(effect.route)
      await effectTried(page)
      expect(await domFallbackProblems(page, effect)).toEqual([])
      expect(failures).toEqual([])
      expect(await faultsOf(page)).toEqual([])
    })

    test('with shaders that do not build the page is complete, and the fault is reported', async ({
      context,
      page,
      visit,
    }) => {
      await recordFaults(context)
      await withBrokenShaders(context)
      const failures = await visit(effect.route)
      await effectTried(page)
      expect(await domFallbackProblems(page, effect)).toEqual([])
      expect(failures).toEqual([])
      expect((await faultsOf(page)).map((fault) => fault.kind)).toContain('gl-error')
    })
  })
}
