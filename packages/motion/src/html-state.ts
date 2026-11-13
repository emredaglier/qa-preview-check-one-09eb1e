/**
 * Typed helpers for the state that lives on `<html>`. JS flips an attribute and CSS reacts, so
 * server and client markup never differ. A project lists its own flags and custom properties here;
 * the type of every setter follows the lists, so a misspelt name fails the typecheck.
 */

/** Presence-only attributes (`data-<name>`). `saver` is set by the idle watcher. */
export const HTML_FLAGS = ['saver'] as const
export type HtmlFlag = (typeof HTML_FLAGS)[number]

/** CSS custom properties written on `<html>` (`'--name'`). Empty until a project adds one. */
export const HTML_VARS = [] as const satisfies readonly `--${string}`[]
export type HtmlVar = (typeof HTML_VARS)[number]

const root = (): HTMLElement | null =>
  typeof document === 'undefined' ? null : document.documentElement

export const setHtmlFlag = (flag: HtmlFlag, on: boolean): void => {
  root()?.toggleAttribute(`data-${flag}`, on)
}

export const hasHtmlFlag = (flag: HtmlFlag): boolean =>
  root()?.hasAttribute(`data-${flag}`) ?? false

/** Sets a custom property on `<html>`; `null` removes it. */
export const setHtmlVar = (name: HtmlVar, value: string | number | null): void => {
  const style = root()?.style
  if (!style) return
  if (value === null) style.removeProperty(name)
  else style.setProperty(name, String(value))
}
