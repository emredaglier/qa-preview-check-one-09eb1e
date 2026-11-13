import { describe, expect, it } from 'vitest'

import {
  ASSET_BUDGET,
  checkAssets,
  imageWidth,
  isBudgeted,
  type AssetFile,
} from './assets-budget.ts'

/** Minimal headers: only the bytes the width is read from, as `imageWidth` reads them. */
const png = (width: number) => {
  const b = new Uint8Array(33)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  new DataView(b.buffer).setUint32(16, width)
  new DataView(b.buffer).setUint32(20, 10)
  return b
}
const gif = (width: number) => {
  const b = new Uint8Array(13)
  b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0)
  new DataView(b.buffer).setUint16(6, width, true)
  return b
}
const jpeg = (width: number) => {
  // SOI, an APP0 segment to skip, then SOF0 with height 10 and the width.
  const b = new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    0x00,
    0x0a,
    width >> 8,
    width & 255,
    0x01,
    0x01,
    0x11,
    0x00,
  ])
  return b
}
const webpLossy = (width: number) => {
  const b = new Uint8Array(40)
  b.set(
    [...'RIFF'].map((c) => c.charCodeAt(0)),
    0,
  )
  b.set(
    [...'WEBP'].map((c) => c.charCodeAt(0)),
    8,
  )
  b.set(
    [...'VP8 '].map((c) => c.charCodeAt(0)),
    12,
  )
  b.set([0x9d, 0x01, 0x2a], 23)
  new DataView(b.buffer).setUint16(26, width, true)
  return b
}
const webpExtended = (width: number) => {
  const b = new Uint8Array(40)
  b.set(
    [...'RIFF'].map((c) => c.charCodeAt(0)),
    0,
  )
  b.set(
    [...'WEBP'].map((c) => c.charCodeAt(0)),
    8,
  )
  b.set(
    [...'VP8X'].map((c) => c.charCodeAt(0)),
    12,
  )
  const w = width - 1
  b.set([w & 255, (w >> 8) & 255, (w >> 16) & 255], 24)
  return b
}
const avif = (...widths: number[]) => {
  const parts = widths.flatMap((width) => {
    const box = new Uint8Array(20)
    new DataView(box.buffer).setUint32(0, 20)
    box.set(
      [...'ispe'].map((c) => c.charCodeAt(0)),
      4,
    )
    new DataView(box.buffer).setUint32(12, width)
    new DataView(box.buffer).setUint32(16, 10)
    return [...box]
  })
  return new Uint8Array(
    [...'\0\0\0\x1cftypavif\0\0\0\0avifmif1'].map((c) => c.charCodeAt(0)).concat(parts),
  )
}

const file = (path: string, size: number, header: Uint8Array = png(100)): AssetFile => ({
  path,
  size,
  header,
})

describe('imageWidth', () => {
  it('reads the width from the header of each raster format', () => {
    expect(imageWidth('.png', png(1234))).toBe(1234)
    expect(imageWidth('.gif', gif(321))).toBe(321)
    expect(imageWidth('.jpg', jpeg(2000))).toBe(2000)
    expect(imageWidth('.jpeg', jpeg(777))).toBe(777)
    expect(imageWidth('.webp', webpLossy(1500))).toBe(1500)
    expect(imageWidth('.webp', webpExtended(3000))).toBe(3000)
  })
  it('takes the widest image of an AVIF, which may also hold a thumbnail', () => {
    expect(imageWidth('.avif', avif(160, 2800))).toBe(2800)
  })
  it('is undefined for bytes that are not the format, instead of guessing', () => {
    expect(imageWidth('.png', new Uint8Array(40))).toBeUndefined()
    expect(imageWidth('.jpg', png(100))).toBeUndefined()
    expect(imageWidth('.webp', png(100))).toBeUndefined()
    expect(imageWidth('.avif', new Uint8Array(40))).toBeUndefined()
  })
})

describe('isBudgeted', () => {
  it('covers images and videos in the tree, and nothing under node_modules, .next, docs or .scratch', () => {
    expect(isBudgeted('apps/web/public/hero.JPG')).toBe(true)
    expect(isBudgeted('apps/web/public/loop.mp4')).toBe(true)
    expect(isBudgeted('apps/web/public/logo.svg')).toBe(false)
    expect(isBudgeted('apps/web/public/app.woff2')).toBe(false)
    expect(isBudgeted('node_modules/x/a.png')).toBe(false)
    expect(isBudgeted('apps/web/.next/static/a.png')).toBe(false)
    expect(isBudgeted('docs/shot.png')).toBe(false)
    expect(isBudgeted('.scratch/x/shot.png')).toBe(false)
  })

  it('exempts docs and .scratch at the top of the repo only, not a folder of that name inside an app', () => {
    expect(isBudgeted('apps/web/public/docs/hero.jpg')).toBe(true)
    expect(isBudgeted('packages/ui/docs/loop.mp4')).toBe(true)
    expect(isBudgeted('apps/web/.scratch/shot.png')).toBe(true)
    expect(isBudgeted('docsy/hero.jpg')).toBe(true)
  })

  it('exempts installed packages and build output wherever a workspace keeps them', () => {
    expect(isBudgeted('apps/web/node_modules/x/a.png')).toBe(false)
    expect(isBudgeted('packages/ui/node_modules/x/a.png')).toBe(false)
    expect(isBudgeted('apps/cms/.next/static/a.png')).toBe(false)
  })
})

describe('checkAssets', () => {
  it('passes images and videos within their limits, and SVGs of any size', () => {
    expect(
      checkAssets([
        file('apps/web/public/a.png', ASSET_BUDGET.imageBytes, png(ASSET_BUDGET.imageWidth)),
        file('apps/web/public/loop.webm', ASSET_BUDGET.videoBytes),
        file('apps/web/public/huge.svg', 50 * 1024 * 1024),
      ]),
    ).toEqual([])
  })

  it('names an image over the byte limit, with its size', () => {
    const [offense] = checkAssets([file('apps/web/public/a.png', ASSET_BUDGET.imageBytes + 1)])
    expect(offense?.path).toBe('apps/web/public/a.png')
    expect(offense?.detail).toMatch(/image limit/)
  })

  it('names an image wider than the limit', () => {
    const offenses = checkAssets([file('a.jpg', 1000, jpeg(ASSET_BUDGET.imageWidth + 1))])
    expect(offenses).toHaveLength(1)
    expect(offenses[0]?.detail).toContain(`${ASSET_BUDGET.imageWidth + 1}px wide`)
  })

  it('names a video over the byte limit, and does not read a video as an image', () => {
    const offenses = checkAssets([file('a.mp4', ASSET_BUDGET.videoBytes + 1, new Uint8Array(4))])
    expect(offenses).toHaveLength(1)
    expect(offenses[0]?.detail).toMatch(/video limit/)
  })

  it('holds icons to the tighter icon limits', () => {
    const offenses = checkAssets([
      file('apps/web/src/app/icon.png', ASSET_BUDGET.iconBytes + 1),
      file('apps/web/src/app/apple-icon2.png', 100, png(ASSET_BUDGET.iconWidth + 1)),
      file('apps/web/src/app/icon-large-photo.png', ASSET_BUDGET.iconBytes + 1),
    ])
    // The third is a content image that merely starts with "icon": the general limit applies.
    expect(offenses.map((o) => o.path)).toEqual([
      'apps/web/src/app/icon.png',
      'apps/web/src/app/apple-icon2.png',
    ])
  })

  it('fails an image whose width cannot be read: "cannot verify" is not "fine"', () => {
    const offenses = checkAssets([file('a.png', 100, new Uint8Array(40))])
    expect(offenses).toHaveLength(1)
    expect(offenses[0]?.detail).toMatch(/cannot verify the width/)
  })

  it('reports every offense, in the order given', () => {
    const offenses = checkAssets([
      file('b.png', ASSET_BUDGET.imageBytes + 1),
      file('ok.png', 10),
      file('a.mp4', ASSET_BUDGET.videoBytes + 1, new Uint8Array(4)),
    ])
    expect(offenses.map((o) => o.path)).toEqual(['b.png', 'a.mp4'])
  })
})
