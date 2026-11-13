/**
 * The tiny inline script that runs first in `<head>`, before first paint (ADR-0008):
 *  - `html[data-js]`: entrance holds only apply when this is set, so with JS off or failing the
 *    server HTML is shown as it is.
 * A project adds its own statements (a stored theme, a load tracker) to `HEAD_SCRIPT_STEPS`.
 * Keep it raw ES5 and tiny; it is inlined into every page.
 */
export const HEAD_SCRIPT_STEPS = [`h.setAttribute('data-js','')`]

export const HEAD_SCRIPT = `(function(){var h=document.documentElement;${HEAD_SCRIPT_STEPS.join(';')}})()`
