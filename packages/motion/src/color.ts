import { clamp01 } from './math'

export type Rgb = readonly [number, number, number]

const toSrgb = (linear: number): number => {
  const v = clamp01(linear)
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
}

/** `oklch(L C h)` to sRGB, 0..1 (CSS Color 4: L as 0..1 or a percentage, C as a number or % of 0.4). */
const parseOklch = (text: string): Rgb | null => {
  const match = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)(%?)\s+(none|-?[\d.]+)(?:deg)?/.exec(text)
  if (!match) return null
  const lightness = Number(match[1]) / (match[2] ? 100 : 1)
  const chroma = Number(match[3]) * (match[4] ? 0.004 : 1)
  const hue = ((match[5] === 'none' ? 0 : Number(match[5])) * Math.PI) / 180
  const a = chroma * Math.cos(hue)
  const b = chroma * Math.sin(hue)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

/**
 * Parses a colour: `rgb()/rgba()` (0-255), `color(srgb r g b)` (0-1) or `oklch()`, which is how
 * the browser hands back the light theme's tokens. Null otherwise.
 */
export const parseCssColor = (value: string): Rgb | null => {
  const text = value.trim().toLowerCase()
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(text)
  if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255]
  const srgb = /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(text)
  if (srgb) return [clamp01(Number(srgb[1])), clamp01(Number(srgb[2])), clamp01(Number(srgb[3]))]
  return parseOklch(text)
}

/**
 * Reads a CSS colour for a GL engine as `[r, g, b]` in 0..1. `property` is a custom property (or
 * any property) on `element` (default `<html>`); the browser resolves it to a computed colour via a
 * probe element. Returns `fallback` (black) when it cannot be read. Read once per sequence.
 */
export const readCssColor = (
  property: string,
  element?: Element,
  fallback: Rgb = [0, 0, 0],
): Rgb => {
  if (typeof document === 'undefined') return fallback
  const source = element ?? document.documentElement
  const raw = getComputedStyle(source).getPropertyValue(property).trim()
  if (!raw) return fallback
  const probe = document.createElement('span')
  probe.style.color = raw
  probe.style.display = 'none'
  source.appendChild(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  return parseCssColor(resolved) ?? parseCssColor(raw) ?? fallback
}
