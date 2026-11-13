// What the secrets-in-bundle check looks for in everything a browser is served (smoke/secrets.spec.ts):
// the values of the server's secrets, and text shaped like a credential. Pure, so it is unit-tested.
//
// Adapted from darkroom.engineering's Satus (e2e/secrets-in-bundle.e2e.ts, MIT; see
// THIRD-PARTY-NOTICES.md). Satus builds with `leakcheck-<NAME>` secrets and greps `.next` for them.
// This repo's gate runs against the built image and has no source `.next` folder, so the check
// reads what the running container serves instead: the HTML and flight data of each page, and
// every script and stylesheet reachable from them. A server value passed into a client component
// shows up there, which a build-time grep over `.next/static` cannot see.

export type Served = { url: string; text: string }
export type Leak = { url: string; kind: 'value' | 'shape'; what: string }

const MIN_SECRET_LENGTH = 8

/** Text that is a credential whatever its value: a leak even if no one listed it. */
export const SECRET_SHAPES: { name: string; pattern: RegExp }[] = [
  { name: 'private key', pattern: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/ },
  { name: 'AWS access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    name: 'GitHub token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/,
  },
  { name: 'Stripe secret key', pattern: /\b[rs]k_live_[A-Za-z0-9]{16,}\b/ },
  { name: 'Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
]

/** The ways a value can be written into a page: as is, in a URL, or as base64. */
const spellings = (secret: string) => [
  secret,
  encodeURIComponent(secret),
  Buffer.from(secret).toString('base64'),
]

/**
 * Every leak in the served files. `secrets` are the values the server holds (the gate's own
 * throwaway ones). A leak names the secret by its position, never by its value, so a report is safe
 * to keep. A secret too short to search for throws: a scan for "abc" would pass and prove nothing.
 */
export function findLeaks(files: Served[], secrets: string[]): Leak[] {
  for (const [index, secret] of secrets.entries()) {
    if (secret.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `secret #${index + 1} is too short to scan for (under ${MIN_SECRET_LENGTH} characters)`,
      )
    }
  }
  const leaks: Leak[] = []
  for (const { url, text } of files) {
    for (const [index, secret] of secrets.entries()) {
      if (spellings(secret).some((spelling) => text.includes(spelling))) {
        leaks.push({ url, kind: 'value', what: `secret #${index + 1}` })
      }
    }
    for (const { name, pattern } of SECRET_SHAPES) {
      if (pattern.test(text)) leaks.push({ url, kind: 'shape', what: name })
    }
  }
  return leaks
}

/**
 * The build files (scripts and stylesheets) a document or script refers to, as paths under
 * `/_next/` (`static/chunks/a.js`), once each. The server writes them in markup as full URLs
 * (`<script src>`, with the CDN prefix) and in flight data and chunk loaders as bare paths, so one
 * pattern finds both; the query string (`?dpl=`) is dropped. The extension must end the name, so
 * `data.json` is not `data.js`; `static/<buildId>/_buildManifest.js` is covered too.
 *
 * It cannot see a chunk whose URL the webpack runtime builds from parts
 * (`"static/chunks/"+e+"."+{...}[e]+".js"`). `builtFilePaths` lists those from the image.
 */
export function chunkPaths(text: string): string[] {
  const found = text.matchAll(
    /static\/(?:(?:chunks|css)\/[^"'\\\s)?<>]+?|[\w-]+\/_(?:build|ssg)Manifest)\.(?:js|css)(?![\w.-])/g,
  )
  return [...new Set([...found].map((match) => match[0]))]
}

/**
 * Every script and stylesheet of a built `.next/static` folder, as paths under `/_next/`
 * (`static/chunks/a.js`), sorted. `relative` are the folder's files relative to it, with `/`.
 * Lazily loaded chunks appear here and in no page, so the scan reads the list, not only links.
 */
export function builtFilePaths(relative: string[]): string[] {
  return relative
    .filter((file) => /\.(?:js|css)$/.test(file))
    .map((file) => `static/${file}`)
    .sort()
}

/** One GET of a path on the site: the status and the body. `headers` ask for flight data (`RSC: 1`). */
export type Fetcher = (
  url: string,
  headers?: Record<string, string>,
) => Promise<{ status: number; text: string }>

/** More than any page of a small site loads; a runaway crawl fails instead of running on. */
const MAX_FILES = 1000

/**
 * Everything the browser would be served, as text: each route as HTML and as flight data (a server
 * value handed to a client component lands there), every script and stylesheet they point at,
 * transitively, and every built file in `builtFiles` (`builtFilePaths`), which catches chunks no page
 * links to. `unserved` are the built files the site did not answer 200 for: a listing that reads
 * nothing proves nothing, so the caller fails on them. A file only referenced from a page that is
 * not served is not reported: the route sweep fails on a 404 the page itself loads.
 */
export async function collectServed(
  get: Fetcher,
  routes: string[],
  builtFiles: string[],
  maxFiles: number = MAX_FILES,
): Promise<{ files: Served[]; unserved: string[] }> {
  const files: Served[] = []
  const unserved: string[] = []
  const seen = new Set<string>()
  const queue: string[] = []
  const listed = new Set(builtFiles.map((file) => `/_next/${file}`))
  const enqueue = (path: string) => {
    const url = `/_next/${path}`
    if (seen.has(url)) return
    seen.add(url)
    queue.push(url)
  }
  const take = async (url: string, headers?: Record<string, string>) => {
    if (files.length >= maxFiles) {
      throw new Error(`the crawl found more than ${maxFiles} files, more than it will read`)
    }
    const { status, text } = await get(url, headers)
    files.push({ url: headers ? `${url} (flight data)` : url, text })
    for (const chunk of chunkPaths(text)) enqueue(chunk)
    return status
  }

  for (const route of routes) {
    await take(route)
    await take(route, { RSC: '1' })
  }
  for (const file of builtFiles) enqueue(file)
  for (let next = queue.shift(); next; next = queue.shift()) {
    const status = await take(next)
    if (listed.has(next) && status !== 200) unserved.push(next)
  }
  return { files, unserved }
}
