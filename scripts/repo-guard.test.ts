// The house starter copies daglier.com's backbone, not its design (ADR-0001). This guard scans the
// whole repo (source, styles, docs, config and file names) for things only daglier.com has: its
// identity, fonts, colours, design tokens, signature effect and component identifiers, and seed
// copy. A copy-paste from daglier.com cannot bring them along.
//
// Every rule is identity-strong on purpose. A bare word such as "portrait", "album", "wave" or
// "Istanbul" is NOT banned: a photographer's project may use `orientation: portrait`, an
// `imageSizes` entry named portrait, or mention the city. Ban the exact identifier, token, colour or
// sentence instead. It is a repo guard in the sense of CODING_STANDARDS.md: it enforces a rule, not
// behaviour. Projects made from the starter keep it.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** This file names every banned term on purpose. */
const SELF = path.join('scripts', 'repo-guard.test.ts')

const SKIP_FILES = new Set(['pnpm-lock.yaml', '.DS_Store'])
/** Binary files get the file-name check only; there is no text to read. */
const isBinary = (file: string) =>
  /\.(png|jpe?g|webp|avif|gif|ico|woff2?|ttf|otf|eot|db|mp4|webm|pdf)$/i.test(file)

type Rule = { kind: string; pattern: RegExp }

export const BANNED: Rule[] = [
  // Identity. `(?<![A-Za-z])` also catches `emre_daglier` and `@daglier/`, but not a user name such
  // as `/Users/emredaglier`; the second rule catches camel case such as `emreDaglier`.
  { kind: 'identity', pattern: /(?<![A-Za-z])daglier/i },
  { kind: 'identity', pattern: /[a-z]Daglier/ },
  { kind: 'identity', pattern: /(?<![A-Za-z])emre(?![a-z])/i },
  { kind: 'identity', pattern: /dglrco/i },

  // Fonts: daglier's UI face and its renamed web subset.
  { kind: 'font', pattern: /cooper[\s_-]?(hewitt|web)/i },
  { kind: 'font', pattern: /--font-cooper/i },

  // Colours: the accent, both themes' backgrounds and the themeColor values, in every notation
  // daglier's token files use (hex, oklch as percentages and as decimals, rgb).
  { kind: 'colour', pattern: /#(39cf67|ebebeb|f0f0f0|0a0a0a)\b/i },
  { kind: 'colour', pattern: /oklch\(\s*(94|14\.5|98\.5)%/i },
  { kind: 'colour', pattern: /oklch\(\s*0?\.(94|145|985)\b/i },
  { kind: 'colour', pattern: /oklch\(\s*0?\.7\s+0?\.15\s+150\b/i },
  { kind: 'colour', pattern: /rgba?\(\s*57[\s,]+207[\s,]+103\b/i },
  { kind: 'colour', pattern: /\b57\s*,\s*207\s*,\s*103\b/ },

  // Design and motion tokens (CSS variables and `<html>` flags).
  {
    kind: 'token',
    pattern:
      /--(curtain-(color|dark|ink)|color-curtain|duration-(exit|enter|move|portrait|curtain|preloader-wipe)|ease-(wave|portrait)|soften|preloader-progress)\b/i,
  },
  { kind: 'token', pattern: /data-(curtain|portrait-open|preloader|entrance-ready)\b/i },

  // Signature effects: engines, stages, hooks and constants.
  { kind: 'effect', pattern: /Wave(Stage|State|Demo)\b|parseWaveDemo|\buseWave\b|MAX_WAVE_DPR/i },
  { kind: 'effect', pattern: /LAG_(CURTAIN|OPENING)|playOpening|openingState|endWaveState/i },
  {
    kind: 'effect',
    pattern:
      /Melt(Stage|Heading|Demo|Engine)|TitleMelt|runMenuMelt|menuMeltFrame|MELT_DURATION|HANDBACK_MELT|MENU_MELT/i,
  },
  { kind: 'effect', pattern: /startSoften|softenExtra|softenFilter|softenRestPx|SOFTEN_[A-Z_]+/ },
  {
    kind: 'effect',
    pattern:
      /Curtain(Canvas|Trigger|Options)|curtain(Link|Open|Wave|State)\b|playCurtain|mountCurtain|onCurtainEnter|curtainEnterClass/i,
  },
  {
    kind: 'effect',
    pattern:
      /PortraitLink|PortraitPrefetch|portraitOpen|sharePortrait|setPortraitOpen|portraitName|canPrefetchPortrait|PORTRAIT_EXIT|ABOUT_PORTRAIT_SIZES/i,
  },
  {
    kind: 'effect',
    pattern:
      /Preloader(State|Config)|PRELOADER_[A-Z_]+|preloaderTracker|whenPreloaderReady|[gs]etPreloaderState|<Preloader\b/,
  },
  {
    kind: 'effect',
    pattern:
      /\b(SpinGlobe|createGlobeLoop|Screensaver|BracketLabel|HomeClock|HomeEntrance|AboutEntrance|EntranceGate|LogoMark|RoleLabel|HydrationSignal)\b/,
  },
  {
    kind: 'effect',
    pattern:
      /startTouchWobble|createEntranceFlags|createDecodeCache|CLOCK_WIPE|SHAKE_KEYFRAMES|rolePaint|shareCrossfade/i,
  },

  // Daglier's content domain: album components, helpers and data readers.
  {
    kind: 'copy',
    pattern:
      /Album(Carousel|Strip|Roll|Lightbox|Hero|Story|Next|ScrollBlur|LeaveMark|sView|Entrance|End|Layout)\b|albumCoverName|shareAlbum|consumeAlbumReturn|markAlbumLeft|getPublishedAlbums?|getAlbumRoutes|getDraftAlbum|PUBLISHED_ALBUMS|ALBUM_ENTRANCE|buildCoverSources/i,
  },

  // Daglier's seed copy: distinctive sentences only.
  { kind: 'copy', pattern: /toward the light/i },
  { kind: 'copy', pattern: /Wanderer['",\s]+Aviator/i },
  { kind: 'copy', pattern: /always somewhere between arriving and leaving/i },
  { kind: 'copy', pattern: /wait where it tends to gather/i },
  { kind: 'copy', pattern: /somewhere between two horizons/i },
  { kind: 'copy', pattern: /staying awake long enough/i },
  { kind: 'copy', pattern: /Photography is that same patience/i },
  { kind: 'copy', pattern: /shoot toward the dark on purpose/i },
  { kind: 'copy', pattern: /the sound a quiet room makes/i },
  { kind: 'copy', pattern: /Data Protection Law No\. ?6698/i },
]

/** Copied file and folder names that are daglier's even when the text inside was rewritten. */
const NAME_RULES: Rule[] = [
  {
    kind: 'effect',
    pattern:
      /(?<=^|[\\/])(melt|wave)[\\/](stage|shaders?|gaussian|downsample|baseline|clip|matrix|lag|band|curtain|opening|play-)/i,
  },
  {
    kind: 'effect',
    pattern:
      /(title|menu)-melt|melt-heading|wave-demo|curtain-(canvas|click|enter)|clock-wipe|logo-shake/i,
  },
]

/** `file (file name): kind "match"` for every banned term in a file's path. */
export function findBannedName(file: string): string[] {
  const hits: string[] = []
  for (const { kind, pattern } of [...BANNED, ...NAME_RULES]) {
    const match = pattern.exec(file)
    if (match) hits.push(`${file} (file name): ${kind} "${match[0]}"`)
  }
  return hits
}

/** `file:line: kind "match"` for every banned term in `text`. */
export function findBannedText(file: string, text: string): string[] {
  const hits: string[] = []
  text.split('\n').forEach((line, index) => {
    for (const { kind, pattern } of BANNED) {
      const match = pattern.exec(line)
      if (match) hits.push(`${file}:${index + 1}: ${kind} "${match[0]}"`)
    }
  })
  return hits
}

/** The file name always, and the text unless the file is binary (`null`). */
export function findBanned(file: string, text: string | null): string[] {
  return [...findBannedName(file), ...(text === null ? [] : findBannedText(file, text))]
}

/** Folders that are never part of the repo, wherever they sit: dependencies and framework output. */
const OUTPUT_DIRS = new Set(['node_modules', '.git', '.output'])
/** Folders skipped only at the repo root; deeper they are ordinary source folders. */
const ROOT_SKIP_DIRS = new Set(['.scratch', 'dist', 'build', 'coverage'])

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (OUTPUT_DIRS.has(entry.name) || entry.name.startsWith('.next')) continue
      if (dir === root && ROOT_SKIP_DIRS.has(entry.name)) continue
      // `.claude/worktrees` holds other checkouts.
      if (entry.name === 'worktrees' && path.basename(dir) === '.claude') continue
      yield* walk(path.join(dir, entry.name))
    } else {
      yield path.join(dir, entry.name)
    }
  }
}

/**
 * The files that belong to the repo: tracked and new-but-not-ignored ones, so build output, logs
 * and anything else git ignores (which may hold absolute paths of the machine) is not scanned.
 * Outside a git checkout it walks the folder instead. The ticket folder `.scratch/` at the root
 * is never scanned: tickets and specs may talk about daglier.com.
 */
function repoFiles(): string[] {
  let files: string[]
  try {
    const out = execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    files = out
      .split('\0')
      .filter(Boolean)
      .map((relative) => path.join(root, relative))
      .filter((file) => fs.existsSync(file))
  } catch {
    files = [...walk(root)]
  }
  return files.filter(
    (file) =>
      !SKIP_FILES.has(path.basename(file)) &&
      path.relative(root, file).split(path.sep)[0] !== '.scratch',
  )
}

describe('findBanned: every rule fires on its own identifier', () => {
  const cases: [string, string, string][] = [
    ['identity', 'a.ts', 'const owner = "emre_daglier"'],
    ['identity', 'a.ts', 'const emreDaglier = 1'],
    ['identity', 'a.md', 'daglier.com, a portfolio'],
    ['identity', 'a.json', '{ "name": "@daglier/ui" }'],
    ['identity', 'a.md', 'Emre wrote this'],
    ['identity', 'a.md', 'instagram.com/dglrco'],
    ['font', 'a.css', 'font-family: "Cooper Hewitt"'],
    ['font', 'a.css', 'font-family: var(--font-cooper-hewitt)'],
    ['colour', 'a.css', 'color: #39CF67'],
    ['colour', 'a.css', 'background: #ebebeb'],
    ['colour', 'a.ts', "themeColor: '#f0f0f0'"],
    ['colour', 'a.ts', "themeColor: '#0a0a0a'"],
    ['colour', 'a.css', '--x: oklch(94% 0 0deg)'],
    ['colour', 'a.css', '--x: oklch(0.94 0 0)'],
    ['colour', 'a.css', '--x: oklch(0.145 0 0)'],
    ['colour', 'a.css', '--x: oklch(.985 0 0)'],
    ['colour', 'a.css', '--accent: oklch(0.7 0.15 150)'],
    ['colour', 'a.css', 'color: rgb(57 207 103)'],
    ['colour', 'a.ts', 'const accent = [57, 207, 103]'],
    ['token', 'a.css', 'color: var(--curtain-color)'],
    ['token', 'a.css', 'transition: var(--duration-portrait)'],
    ['token', 'a.css', 'transition-timing-function: var(--ease-wave)'],
    ['token', 'a.css', 'filter: blur(var(--soften))'],
    ['token', 'a.css', 'html[data-curtain] .x {}'],
    ['effect', 'a.ts', 'createWaveStage(canvas)'],
    ['effect', 'a.ts', 'let state: WaveState'],
    ['effect', 'a.tsx', '<WaveDemo />'],
    ['effect', 'a.ts', 'parseWaveDemo(search)'],
    ['effect', 'a.ts', 'useWave()'],
    ['effect', 'a.ts', 'createMeltStage(canvas)'],
    ['effect', 'a.tsx', '<MeltHeading />'],
    ['effect', 'a.ts', 'startSoften({})'],
    ['effect', 'a.tsx', '<CurtainCanvas />'],
    ['effect', 'a.tsx', '<Link {...curtainLink} />'],
    ['effect', 'a.tsx', '<PortraitLink />'],
    ['effect', 'a.ts', 'preloaderTracker()'],
    ['effect', 'a.tsx', '<SpinGlobe />'],
    ['effect', 'a.tsx', '<Screensaver />'],
    ['effect', 'a.tsx', '<BracketLabel label="X" />'],
    ['effect', 'a.tsx', '<HomeClock />'],
    ['copy', 'a.tsx', '<AlbumCarousel albums={x} />'],
    ['copy', 'a.ts', 'const albums = await getPublishedAlbums()'],
    ['copy', 'a.md', 'The world keeps turning toward the light.'],
    ['copy', 'a.json', '"roles": ["Wanderer", "Aviator"]'],
    ['copy', 'a.md', 'I shoot toward the dark on purpose.'],
  ]
  it.each(cases)('%s: %s %j', (kind, file, text) => {
    const hits = findBanned(file, text)
    expect(hits.length, `no rule fired for: ${text}`).toBeGreaterThan(0)
    expect(hits.some((hit) => hit.includes(`: ${kind} "`))).toBe(true)
  })

  it('reports the line number', () => {
    expect(findBanned('a.css', 'x\n--curtain-color: #39CF67;')).toEqual([
      'a.css:2: colour "#39CF67"',
      'a.css:2: token "--curtain-color"',
    ])
  })

  it('finds a copied daglier file name, with or without text to read', () => {
    expect(findBanned('packages/motion/src/melt/stage.ts', '')).toEqual([
      'packages/motion/src/melt/stage.ts (file name): effect "melt/stage"',
    ])
    expect(findBanned('packages/ui/fonts/CooperHewitt-Book.woff2', null)).toEqual([
      'packages/ui/fonts/CooperHewitt-Book.woff2 (file name): font "CooperHewitt"',
    ])
    expect(findBanned('apps/web/src/lib/curtain-click.ts', '')).toHaveLength(1)
  })
})

describe('findBanned: ordinary words and look-alikes are not leftovers', () => {
  const clean: [string, string][] = [
    ['a.css', '@media (orientation: portrait) { .hero { aspect-ratio: 3 / 4 } }'],
    ['a.ts', "imageSizes: [{ name: 'portrait', width: 800, height: 1200 }]"],
    ['a.md', 'A photograph of an album cover. We are based in Istanbul.'],
    ['a.md', 'Our studio is in Istanbul, Türkiye.'],
    ['a.ts', 'const waveform = 1 // wave, melt, soften and curtain are ordinary words'],
    ['a.css', '.curtain-wall { color: #123456; background: oklch(0.7 0.1 200) }'],
    ['a.ts', "const albumCount = albums.length // a client's own albums collection"],
    ['a.md', '/Users/emredaglier/Documents/Development/some-project'],
    ['a.css', 'font-family: Geist, sans-serif'],
    ['a.ts', 'const Preloader = () => null'],
    ['a.md', 'Wanderer is a fine word, and so is Aviator.'],
    ['assets/portrait/hero.ts', ''],
  ]
  it.each(clean)('%s: %j', (file, text) => {
    expect(findBanned(file, text)).toEqual([])
  })
})

describe('repo guard: no daglier design in the house starter', () => {
  it('finds no daglier identifier, token, font, colour, copy or file name anywhere in the repo', () => {
    const hits: string[] = []
    for (const file of repoFiles()) {
      const relative = path.relative(root, file)
      if (relative === SELF) continue
      hits.push(...findBanned(relative, isBinary(file) ? null : fs.readFileSync(file, 'utf8')))
    }
    expect(hits).toEqual([])
  })
})
