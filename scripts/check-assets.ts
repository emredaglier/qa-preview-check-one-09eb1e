// `pnpm check:assets`: fails (exit 1) listing every git-tracked image or video over the asset-weight
// budget in scripts/assets-budget.ts. Run by `infra/ci.sh check` on every pull request.
//
//   node scripts/check-assets.ts [repo folder]     (default: the repo this file is in)
//
// Adapted from darkroom.engineering's Satus (lib/scripts/check-assets.ts, MIT; see
// THIRD-PARTY-NOTICES.md).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import {
  ASSET_BUDGET,
  HEADER_BYTES,
  checkAssets,
  isBudgeted,
  type AssetFile,
} from './assets-budget.ts'

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '..'))

function trackedFiles(): string[] {
  try {
    // -z: names with spaces or quotes come out unquoted.
    return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean)
  } catch {
    console.error(`check:assets: \`git ls-files\` failed in ${root}: is it a git repository?`)
    process.exit(1)
  }
}

function read(relative: string): AssetFile | null {
  const file = path.join(root, relative)
  // Tracked but deleted in the working tree: nothing to weigh.
  if (!fs.existsSync(file)) return null
  const { size } = fs.statSync(file)
  const handle = fs.openSync(file, 'r')
  try {
    const header = Buffer.alloc(Math.min(size, HEADER_BYTES))
    fs.readSync(handle, header, 0, header.length, 0)
    return { path: relative, size, header }
  } finally {
    fs.closeSync(handle)
  }
}

const files = trackedFiles()
  .filter(isBudgeted)
  .map(read)
  .filter((file): file is AssetFile => file !== null)
const offenses = checkAssets(files)

if (offenses.length > 0) {
  console.error('check:assets: asset weight budget exceeded\n')
  for (const { path: file, detail } of offenses) console.error(`  ${file}: ${detail}`)
  console.error(
    `\nRe-encode or replace the files (images: ${ASSET_BUDGET.imageBytes / 1024} KB and ` +
      `${ASSET_BUDGET.imageWidth}px wide at most), or change the budget in scripts/assets-budget.ts ` +
      "if this project's is different.",
  )
  process.exit(1)
}
console.log(`check:assets: ${files.length} tracked image and video files, all within budget`)
