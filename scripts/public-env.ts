// The build-time half of "no secrets in the bundle", as a pure function over one file's text, so it
// is unit-tested (public-env.test.ts, which also runs it over this repository). Next inlines
// `NEXT_PUBLIC_*` values into browser code at build time, so a secret under that prefix ships to
// every visitor; and a client component that reads a server variable is a sign a secret is about to
// be passed to it.
//
// Adapted from darkroom.engineering's Satus (e2e/secrets-in-bundle.e2e.ts, MIT; see
// THIRD-PARTY-NOTICES.md), which fails when a server secret in its env schema reaches `.next`.

/** `NEXT_PUBLIC_` followed by a name that says secret. A public API key is not named like this. */
const PUBLIC_SECRET = /NEXT_PUBLIC_[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE)[A-Z0-9_]*/g
const CLIENT_FILE = /\.(?:tsx?|jsx?|mjs)$/
/** The directive comes first in the file: only whitespace and comments may precede it. */
const USE_CLIENT = /^(?:\s|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*['"]use client['"]/

const NAME = '[A-Za-z_][A-Za-z0-9_]*'
const DOT_READ = new RegExp(`process\\.env\\.(${NAME})`, 'g')
const BRACKET_READ = new RegExp(`process\\.env\\[\\s*['"\`](${NAME})['"\`]\\s*\\]`, 'g')
const DESTRUCTURE = /\{([^{}]*)\}\s*=\s*process\.env\b/g

/** Every variable name a file reads from `process.env`: by dot, by bracket or by destructuring. */
function envReads(text: string): string[] {
  const names = [
    ...[...text.matchAll(DOT_READ)].map((match) => match[1]!),
    ...[...text.matchAll(BRACKET_READ)].map((match) => match[1]!),
  ]
  for (const [, list] of text.matchAll(DESTRUCTURE)) {
    // `A`, `A: alias`, `A = 'default'`, and `...rest` (which names nothing).
    for (const entry of list!.split(',')) {
      const name = new RegExp(`^\\s*(${NAME})\\s*(?:[:=]|$)`).exec(entry)?.[1]
      if (name) names.push(name)
    }
  }
  return [...new Set(names)]
}

/** What is wrong in one file: a secret under the public prefix, or a server variable in a client file. */
export function publicEnvProblems(file: string, text: string): string[] {
  const problems = [...text.matchAll(PUBLIC_SECRET)].map(
    (match) =>
      `${file}: ${match[0]} is shipped to every visitor: a secret must not be NEXT_PUBLIC_`,
  )
  if (CLIENT_FILE.test(file) && USE_CLIENT.test(text)) {
    for (const name of envReads(text)) {
      if (name !== 'NODE_ENV' && !name.startsWith('NEXT_PUBLIC_')) {
        problems.push(`${file}: a client component reads process.env.${name}, a server variable`)
      }
    }
  }
  return problems
}
