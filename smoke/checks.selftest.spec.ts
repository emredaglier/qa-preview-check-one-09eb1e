// Each gate check against a deliberately broken page, so a check that has gone blind (a selector
// that matches nothing, an assertion that cannot fail) is itself a failing test. The broken pages
// are served from `/__selftest/...` by the test (page.route), never by the app, so no route of the
// site changes. The same check functions the real specs use run here; the real specs prove the
// other direction, that the template passes.
//
// The secrets scan is proven in smoke/secrets-scan.test.ts (unit) and by
// `SMOKE_EXTRA_SECRETS='["a string the page serves"]' pnpm smoke -g "no server secret"`, which
// must fail (infra/README.md, "Smoke gate").
import type { Page } from '@playwright/test'

import { a11yProblems } from './a11y.ts'
import { expect, test } from './fixtures.ts'
import { sweepProblems } from './sweep.ts'
import {
  domFallbackProblems,
  effectTried,
  withBrokenShaders,
  withoutWebGL,
  type EffectPage,
} from './webgl.ts'

const page = (title: string, body: string, head = '') =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}</body></html>`

const PAGES = {
  clean: page('Clean', '<main id="main"><h1>Clean page</h1><p>Some text.</p></main>'),
  // No lang, no title, no main, no h1, an image without alt, a button and a link without a name.
  a11yBroken:
    '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
    '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">' +
    '<button></button><a href="/"></a></body></html>',
  // An empty title, no h1 and a console error.
  sweepBroken: page(
    '',
    '<main id="main"><p>No heading.</p></main><script>console.error("boom")</script>',
  ),
  // The page's effect hides the content until WebGL2 works.
  needsWebGL: page(
    'Needs WebGL',
    '<main id="main"><h1>Needs WebGL</h1></main>' +
      '<script>try{if(!document.createElement("canvas").getContext("webgl2"))' +
      'document.getElementById("main").style.visibility="hidden"}catch(e){}</script>',
  ),
  // The effect's canvas stays on the page whatever happens.
  deadCanvas: page(
    'Dead canvas',
    '<main id="main"><h1>Dead canvas</h1><canvas class="fx"></canvas></main>',
  ),
  // The content is in the HTML but invisible until the effect fades it in.
  faded: page('Faded', '<main id="main" style="opacity:0"><h1>Faded</h1></main>'),
}

const serve = (target: Page, name: string, body: string, status = 200) =>
  target.route(`**/__selftest/${name}`, (route) =>
    route.fulfill({ status, contentType: 'text/html', body }),
  )
const path = (name: string) => `/__selftest/${name}`
/** A broken page stays broken: the check's retry has nothing to wait for. */
const BROKEN_WAIT = 1_000
const effect = (name: string, text: string): EffectPage => ({
  route: path(name),
  text: [text],
  canvas: 'canvas.fx',
})

test.describe('check self-test: accessibility', () => {
  test('finds an unnamed image, button and link, and the missing structure', async ({
    page: p,
  }) => {
    await serve(p, 'a11y-broken', PAGES.a11yBroken)
    await p.goto(path('a11y-broken'))
    const problems = (await a11yProblems(p)).join('\n')
    expect(problems).toContain('axe image-alt')
    expect(problems).toContain('axe button-name')
    expect(problems).toContain('axe link-name')
    expect(problems).toContain('<html> has no lang')
    expect(problems).toContain('no <title>')
    expect(problems).toContain('0 <main> landmarks')
    expect(problems).toContain('0 <h1> headings')
  })

  test('finds nothing on a clean page', async ({ page: p }) => {
    await serve(p, 'clean', PAGES.clean)
    await p.goto(path('clean'))
    expect(await a11yProblems(p)).toEqual([])
  })
})

test.describe('check self-test: route sweep', () => {
  test('finds a console error, an empty title and a missing h1', async ({ page: p, visit }) => {
    await serve(p, 'sweep-broken', PAGES.sweepBroken)
    const problems = (await sweepProblems(p, visit, path('sweep-broken'))).join('\n')
    expect(problems).toContain('console error: boom')
    expect(problems).toContain('no <title>')
    expect(problems).toContain('0 <h1> headings')
  })

  test('fails a route that answers a server error', async ({ page: p, visit }) => {
    await serve(p, 'gone', PAGES.clean, 500)
    await expect(sweepProblems(p, visit, path('gone'))).rejects.toThrow()
  })

  test('finds nothing on a clean page', async ({ page: p, visit }) => {
    await serve(p, 'clean', PAGES.clean)
    expect(await sweepProblems(p, visit, path('clean'))).toEqual([])
  })
})

test.describe('check self-test: WebGL DOM fallback', () => {
  test('finds content that stays hidden without WebGL', async ({ context, page: p, visit }) => {
    await withoutWebGL(context)
    await serve(p, 'needs-webgl', PAGES.needsWebGL)
    await visit(path('needs-webgl'))
    await effectTried(p)
    expect(await domFallbackProblems(p, effect('needs-webgl', 'Needs WebGL'), BROKEN_WAIT)).toEqual(
      ['"Needs WebGL" is not visible without WebGL'],
    )
  })

  test('finds an effect canvas left on the page', async ({ context, page: p, visit }) => {
    await withBrokenShaders(context)
    await serve(p, 'dead-canvas', PAGES.deadCanvas)
    await visit(path('dead-canvas'))
    expect(await domFallbackProblems(p, effect('dead-canvas', 'Dead canvas'), BROKEN_WAIT)).toEqual(
      ['1 effect canvas left on the page after the effect failed'],
    )
  })

  test('finds content that is there but transparent', async ({ page: p, visit }) => {
    await serve(p, 'faded', PAGES.faded)
    await visit(path('faded'))
    // `isVisible` is true for opacity 0, so the problem is the transparency.
    expect(await domFallbackProblems(p, effect('faded', 'Faded'), BROKEN_WAIT)).toEqual([
      '"Faded" is there but transparent without WebGL',
    ])
  })

  test('finds an effect that never asks for a WebGL context, so there is nothing to check yet', async ({
    context,
    page: p,
    visit,
  }) => {
    await withoutWebGL(context)
    await serve(p, 'clean', PAGES.clean)
    await visit(path('clean'))
    await expect(effectTried(p, BROKEN_WAIT)).rejects.toThrow('never asked for a WebGL context')
  })

  test('finds nothing on a page that works without WebGL', async ({ context, page: p, visit }) => {
    await withoutWebGL(context)
    await serve(p, 'clean', PAGES.clean)
    await visit(path('clean'))
    expect(await domFallbackProblems(p, effect('clean', 'Clean page'))).toEqual([])
  })
})
