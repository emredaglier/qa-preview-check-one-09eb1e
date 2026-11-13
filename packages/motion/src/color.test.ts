// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { parseCssColor, readCssColor } from './color'
import { forAll } from './test-support'

describe('css colour readback', () => {
  it('parses rgb, rgba and color(srgb)', () => {
    expect(parseCssColor('rgb(255, 0, 51)')).toEqual([1, 0, 0.2])
    expect(parseCssColor('rgba(0, 255, 0, 0.5)')).toEqual([0, 1, 0])
    expect(parseCssColor('color(srgb 0.5 0.25 1)')).toEqual([0.5, 0.25, 1])
    expect(parseCssColor('lab(50% 40 59)')).toBeNull()
  })

  it('parses oklch, as the browser returns it for the light theme tokens', () => {
    const near = (actual: readonly number[] | null, expected: number[]) => {
      expect(actual).not.toBeNull()
      expected.forEach((value, i) => expect(actual![i]!).toBeCloseTo(value, 2))
    }
    // Greys: lightness 1 is white, 0 is black, 0.5 is the mid grey #636363 (99 / 255).
    near(parseCssColor('oklch(1 0 0)'), [1, 1, 1])
    near(parseCssColor('oklch(0 0 0)'), [0, 0, 0])
    near(parseCssColor('oklch(0.5 0 0)'), [99 / 255, 99 / 255, 99 / 255])
    near(parseCssColor('oklch(50% 0 0deg)'), [99 / 255, 99 / 255, 99 / 255])
    // a chromatic colour: oklch(0.6 0.2 30) is a red, so red is the largest channel
    const red = parseCssColor('oklch(0.6 0.2 30)')!
    expect(red[0]).toBeGreaterThan(red[1])
    expect(red[0]).toBeGreaterThan(red[2])
  })

  it('keeps every channel inside 0..1, whatever the oklch input', () => {
    forAll(
      300,
      [
        [0, 1.2],
        [0, 0.5],
        [0, 360],
      ],
      (lightness, chroma, hue) => {
        const rgb = parseCssColor(`oklch(${lightness} ${chroma} ${hue})`)!
        for (const channel of rgb) {
          expect(channel).toBeGreaterThanOrEqual(0)
          expect(channel).toBeLessThanOrEqual(1)
        }
      },
    )
  })

  it('makes a lighter grey at least as bright in every channel', () => {
    forAll(
      300,
      [
        [0, 1],
        [0, 1],
      ],
      (a, b) => {
        const [dark, light] = a <= b ? [a, b] : [b, a]
        const low = parseCssColor(`oklch(${dark} 0 0)`)!
        const high = parseCssColor(`oklch(${light} 0 0)`)!
        low.forEach((channel, i) => expect(high[i]!).toBeGreaterThanOrEqual(channel))
      },
    )
  })

  it('reads a colour the browser keeps in oklch instead of falling back to black', () => {
    document.documentElement.style.setProperty('--tint', 'oklch(1 0 0deg)')
    const tint = readCssColor('--tint')
    expect(tint[0]).toBeCloseTo(1, 2)
    expect(tint[2]).toBeCloseTo(1, 2)
  })

  it('reads a custom property through the browser', () => {
    document.documentElement.style.setProperty('--tint-rgb', 'rgb(0, 255, 0)')
    expect(readCssColor('--tint-rgb')).toEqual([0, 1, 0])
  })

  it('falls back when the property is missing', () => {
    expect(readCssColor('--missing')).toEqual([0, 0, 0])
    expect(readCssColor('--missing', undefined, [1, 1, 1])).toEqual([1, 1, 1])
  })
})
