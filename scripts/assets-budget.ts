// The asset-weight budget: which tracked images and videos are too heavy to ship. Pure, so it is
// unit-tested (assets-budget.test.ts); scripts/check-assets.ts reads the files and calls it.
//
// Adapted from darkroom.engineering's Satus (https://github.com/darkroomengineering/satus,
// lib/scripts/check-assets.ts, MIT; see THIRD-PARTY-NOTICES.md). Changes: the logic is a pure
// function instead of a Bun script, the whole tracked tree is scanned instead of two folders, and
// AVIF widths are read (Satus fails every AVIF).

/** A project tunes these to its own weight budget. */
export const ASSET_BUDGET = {
  videoBytes: 2 * 1024 * 1024,
  imageBytes: 1 * 1024 * 1024,
  imageWidth: 2400,
  // File-based metadata icons (`icon.png`, `apple-icon.png`, `favicon.png`) get a far tighter
  // budget: every visitor downloads them and browsers draw them at 16-180px.
  iconBytes: 48 * 1024,
  iconWidth: 512,
} as const

/** Bytes read from the start of an image: its dimension header sits well within this. */
export const HEADER_BYTES = 256 * 1024

const VIDEO = new Set(['.mp4', '.webm', '.mov'])
const RASTER = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'])
/** Never tracked content, wherever a workspace keeps it. */
const SKIPPED_ANYWHERE = ['node_modules/', '.next/']
/** Not shipped, so exempt, but only at the top of the repo: `apps/web/public/docs/` ships. */
const SKIPPED_AT_ROOT = ['docs/', '.scratch/']
const ICON_STEM = /^(icon|apple-icon|favicon)\d*$/

export type AssetFile = { path: string; size: number; header: Uint8Array }
export type Offense = { path: string; detail: string }

const extname = (path: string) => {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? '' : path.slice(dot).toLowerCase()
}
const stem = (path: string) => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot === -1 ? name : name.slice(0, dot)
}

/** Whether a tracked path is an image or a video the budget applies to (SVG is exempt). */
export function isBudgeted(path: string): boolean {
  if (
    SKIPPED_AT_ROOT.some((prefix) => path.startsWith(prefix)) ||
    SKIPPED_ANYWHERE.some((prefix) => path.startsWith(prefix) || path.includes(`/${prefix}`))
  ) {
    return false
  }
  const ext = extname(path)
  return VIDEO.has(ext) || RASTER.has(ext)
}

const ascii = (b: Uint8Array, at: number, text: string) =>
  [...text].every((char, i) => b[at + i] === char.charCodeAt(0))

const u32be = (b: Uint8Array, at: number) =>
  (((b[at] ?? 0) << 24) | ((b[at + 1] ?? 0) << 16) | ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0)) >>>
  0
const u16le = (b: Uint8Array, at: number) => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8)

function pngWidth(b: Uint8Array) {
  return b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 'PNG') ? u32be(b, 16) : undefined
}

/** The first start-of-frame segment of a JPEG carries the size. */
function jpegWidth(b: Uint8Array) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return undefined
  let at = 2
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) {
      at++
      continue
    }
    const marker = b[at + 1] ?? 0
    // SOF0-SOF15, but not DHT (C4), JPG (C8) or DAC (CC), which share the range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return ((b[at + 7] ?? 0) << 8) | (b[at + 8] ?? 0)
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      at += 2
      continue
    }
    at += 2 + (((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0))
  }
  return undefined
}

/** RIFF container: an extended (VP8X), lossy (VP8 ) or lossless (VP8L) chunk. */
function webpWidth(b: Uint8Array) {
  if (b.length < 30 || !ascii(b, 0, 'RIFF') || !ascii(b, 8, 'WEBP')) return undefined
  if (ascii(b, 12, 'VP8X')) return 1 + ((b[24] ?? 0) | ((b[25] ?? 0) << 8) | ((b[26] ?? 0) << 16))
  if (ascii(b, 12, 'VP8 ') && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    return u16le(b, 26) & 0x3fff
  }
  if (ascii(b, 12, 'VP8L') && b[20] === 0x2f) {
    return 1 + ((((b[22] ?? 0) & 0x3f) << 8) | (b[21] ?? 0))
  }
  return undefined
}

function gifWidth(b: Uint8Array) {
  return b.length >= 10 && ascii(b, 0, 'GIF') ? u16le(b, 6) : undefined
}

/** Image-spatial-extent boxes (`ispe`) hold each image's size; the widest is the picture. */
function avifWidth(b: Uint8Array) {
  if (b.length < 12 || !ascii(b, 4, 'ftyp')) return undefined
  let widest: number | undefined
  for (let at = 8; at + 16 <= b.length; at++) {
    if (ascii(b, at, 'ispe')) widest = Math.max(widest ?? 0, u32be(b, at + 8))
  }
  return widest
}

/** The width of an image from its own header, or undefined when the bytes are not that format. */
export function imageWidth(ext: string, header: Uint8Array): number | undefined {
  switch (ext) {
    case '.png':
      return pngWidth(header)
    case '.jpg':
    case '.jpeg':
      return jpegWidth(header)
    case '.webp':
      return webpWidth(header)
    case '.gif':
      return gifWidth(header)
    case '.avif':
      return avifWidth(header)
    default:
      return undefined
  }
}

const size = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)}KB` : `${(bytes / (1024 * 1024)).toFixed(2)}MB`

/** Every file over its limit. An image whose width cannot be read fails: unverified is not fine. */
export function checkAssets(files: AssetFile[]): Offense[] {
  const offenses: Offense[] = []
  for (const { path, size: bytes, header } of files) {
    const ext = extname(path)
    if (VIDEO.has(ext)) {
      if (bytes > ASSET_BUDGET.videoBytes) {
        offenses.push({
          path,
          detail: `${size(bytes)} > ${size(ASSET_BUDGET.videoBytes)} video limit`,
        })
      }
      continue
    }
    if (!RASTER.has(ext)) continue

    const icon = ICON_STEM.test(stem(path))
    const maxBytes = icon ? ASSET_BUDGET.iconBytes : ASSET_BUDGET.imageBytes
    const maxWidth = icon ? ASSET_BUDGET.iconWidth : ASSET_BUDGET.imageWidth
    const role = icon ? 'icon' : 'image'
    if (bytes > maxBytes) {
      offenses.push({ path, detail: `${size(bytes)} > ${size(maxBytes)} ${role} limit` })
    }
    const width = imageWidth(ext, header)
    if (width === undefined) {
      offenses.push({
        path,
        detail: `cannot verify the width (not a readable ${ext} header): re-encode it, or fix the file`,
      })
    } else if (width > maxWidth) {
      offenses.push({ path, detail: `${width}px wide > ${maxWidth}px ${role} limit` })
    }
  }
  return offenses
}
