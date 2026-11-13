// The frame-time scenarios, as data. One registry: a motion effect adds or adjusts its own entry
// here and nothing else in perf/.
//
// A scenario runs only if `requires` matches an element on `path`; otherwise it is skipped with
// a notice. So a feature that has not landed yet never fails the suite. The ticket that builds
// the feature owns making `requires` match (a `data-perf` hook is the usual choice).

export type Step =
  /** Wait (ms). */
  | { do: 'wait'; ms: number }
  /** Click the first element matching `selector`. */
  | { do: 'click'; selector: string }
  /** Mouse wheel scroll of `total` px in `steps` equal wheel events, `intervalMs` apart. */
  | { do: 'scroll'; total: number; steps: number; intervalMs: number }
  /** Press on `selector`, drag `dx` px horizontally in `steps` moves, release. */
  | { do: 'drag'; selector: string; dx: number; steps: number; intervalMs: number }
  /** Move the mouse across `selector` left to right in `steps` moves. */
  | { do: 'sweep'; selector: string; steps: number; intervalMs: number }

export type Scenario = {
  id: string
  title: string
  /** Page to open. */
  path: string
  /** CSS selector that exists only when the feature has landed. */
  requires: string
  /** The steps that are measured. Frames are recorded from the first step to the last. */
  steps: Step[]
}

/**
 * The page the idle-CPU check opens: one that runs a decorative loop. `null` when the project has
 * none, and the check is then skipped with a notice. A project with such a loop points
 * this at its page.
 */
export const IDLE_PATH: string | null = null

export const SCENARIOS: Scenario[] = []

/** Why a scenario cannot run (a notice for the log and the report), or null if it can. */
export function skipReason(scenario: Scenario, matches: number): string | null {
  return matches > 0
    ? null
    : `${scenario.id}: feature not on the page yet (no element matches ${scenario.requires})`
}
