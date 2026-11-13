# @house/motion

Shared motion plumbing and the written contract for WebGL effects. The root entry has no React and
is safe to import on the server: every browser-reading helper returns an inert value when there is
no `window` or `document`. React hooks live in `@house/motion/react`. The effects library starts
empty; a project adds its own effects, and
each follows the contract below.

## `@house/motion`

- `addTick(fn)` / `removeTick(fn)`: `gsap.ticker` with per-callback isolation. The first throw is
  logged; after 5 failures in a row the callback is removed and a `ticker-callback-removed` fault
  is reported. Callbacks do not run while the tab is hidden.
- `cappedTick(fn, hz = 60)`: wraps a tick so it runs at most about `hz` times a second (for
  decorative loops on 120 Hz screens).
- `createIdleWatcher({ timeoutMs })` -> `{ watch(fn), dispose() }`: idle detection for mouse
  devices only; toggles `html[data-saver]`, throttles resets to 4 per second.
- `configureIdle({ defaultSeconds, routes })` / `idleTimeoutMs(pathname)`: the idle timeouts are
  settings. The default is 180 s on every route; `routes` maps an exact pathname to its own
  seconds, e.g. `configureIdle({ routes: { '/': 60 } })`. Call it once at startup.
- Test hooks, both set on `window` by an e2e test before load: `__HOUSE_IDLE_MS__` (a positive
  number overrides the idle timeout on every route) and `__HOUSE_TICK_FAULT__` (`true` makes the
  first callback that runs throw every frame).
- `HTML_FLAGS`, `HTML_VARS`, `setHtmlFlag`, `hasHtmlFlag`, `setHtmlVar`: state that lives on
  `<html>`, typed from two lists. Flags are presence-only `data-*` attributes; vars are custom
  properties. The lists start with the one flag the idle watcher sets (`saver`) and no vars: a
  project adds its names to the lists, and a misspelt name then fails the typecheck. CSS reacts to
  the attributes, so server and client markup never differ.
- `reportMotionFault(kind, detail)` / `MOTION_FAULT_EVENT`: dispatches `house:motion-fault` (kinds
  `ticker-callback-removed`, `gl-context-lost`, `gl-error`). Every GL effect calls it. Rename the
  event with the project (see the root README).
- `prefersReducedMotion()`, `hasFinePointer()`, `hasWebGL2()`, `supportsViewTransitions()`:
  capability checks.
- `registerLenis` / `unregisterLenis` / `getActiveLenis` / `stopActiveLenis` / `startActiveLenis`:
  the active Lenis, so a menu or modal can pause it. (`lenis` itself is not a dependency; the
  registry only needs `stop` and `start`.)
- `parseCubicBezier(css)`, `cubicBezierEase(points)`, `readEase('--ease-name')`: a CSS
  cubic-bezier as a GSAP-compatible ease, so CSS and GSAP share one curve. Linear when the
  property is missing.
- `readCssColor(property, element?, fallback?)` / `parseCssColor(value)`: a CSS colour as
  `[r, g, b]` in 0..1 for GL effects. Read it once per sequence, not per frame.
- `clamp`, `clamp01`, `smoothToward(current, target, dtSeconds, rate)`: small pure helpers.
  `smoothToward` is frame-rate independent and snaps onto the target, so a loop can tell when it
  has settled.

## `@house/motion/react`

- `useIdle()`: true while the visitor is idle (shared watcher, timeouts from `configureIdle`).
- `useTick(fn)`: runs `fn` on the safe ticker while mounted.
- `useReducedMotion()`: `prefers-reduced-motion`, read after mount (false during SSR and
  hydration).

## The engine contract

Every WebGL effect in a project follows these four rules. They exist because each one was a bug
somewhere first: a blank page when WebGL2 is missing, a dead canvas after the GPU reset, a canvas
reused after React Strict Mode ran an effect twice, a failure nobody was told about.

1. **`ok: false` and plain HTML.** An effect never needs WebGL2 for the page to be complete.
   Without WebGL2, or when a shader does not compile or link, or while the context is lost, the
   effect reports `ok: false`, every method is a no-op that does not throw, and the page shows its
   plain HTML (the text, the image, the CSS) exactly as the server rendered it. The effect adds to
   the page; it does not hold content back. Check for WebGL2 by creating the context on the
   canvas you will use, not by probing a second one.
2. **Self-rebuild after a lost context.** Listen for `webglcontextlost` on the canvas and call
   `preventDefault()` (without it the browser never restores the context), set `ok` to false and
   stop drawing. On `webglcontextrestored`, build the GPU resources again (program, buffers,
   textures: they were all lost) and redraw the last state, so `ok` is true again with no help
   from the caller. A restore that cannot rebuild stays `ok: false`.
3. **A fresh canvas for every React effect run.** A disposed or lost context cannot be reused, and
   Strict Mode runs effects twice in development. Create the canvas element and the effect inside
   the `useEffect`, call `dispose()` in its cleanup (which removes the canvas, the listeners and
   the loop, and hands the GPU context back), and never keep a canvas or a stage across runs.
   `dispose()` is safe to call twice.
4. **Faults through the shared event.** A silent failure is reported with
   `reportMotionFault(kind, detail)`, never with a bare `console.error`: `gl-context-lost` for a
   lost context, `gl-error` for a shader or program that fails to build (at the start or on
   restore), with the effect's name as `detail`. Missing WebGL2 is a capability gap, not a fault,
   and is not reported. Observability listens for the event on `window`.

Also, for effects that run a loop:

- Drive it from `addTick` (wrapped in `cappedTick` when it is decorative), so one throwing effect
  cannot stop the others.
- Pause it while `useIdle()` is true, and stop drawing when nothing moves: a settled effect should
  cost close to nothing (`pnpm perf` measures idle CPU).
- Draw one still frame, with no loop, when `useReducedMotion()` is true.
- Read colours from CSS once (`readCssColor`), never per frame. Browsers hand back `oklch()` and
  `color()` values from `getComputedStyle`; the parser understands them, and a colour it cannot
  read falls back to the colour you passed rather than to black.
- Cap the device pixel ratio, allocate nothing per frame, and keep CPU and shader maths that must
  agree (a falloff curve, say) side by side with a comment saying so.
