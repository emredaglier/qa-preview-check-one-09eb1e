# Agent rules

The rules for every agent working in this repo, and in every project made from it. This file is the
single source: `CLAUDE.md` only imports it, because Claude Code skips `AGENTS.md` when a full
`CLAUDE.md` exists. Change it by deliberate review, not in passing.

Adapted from the engineering standards of darkroom.engineering's Satus (MIT, see
`THIRD-PARTY-NOTICES.md`): proof of work, no faked measurements, effects gated with a DOM fallback,
and checks in CI that fail the pull request.

## Project

A house starter: the backbone of every project, without a design. Decisions are in `docs/adr/`.
When you start a project from it, rename the `@house/*` workspace scope, replace the placeholder
text, and fill `packages/ui` with the project's own design (`README.md`, "Starting a project").

## The playbook

**Before debugging or starting a ticket, check the playbook.** Load the playbook topic skill that
matches the symptom or the area you are about to work in, and check each lesson in it against the
current code. A lesson is a hint from an earlier project, not a fact: it may be stale or not
apply here. If no topic matches, go on. Do not write to the playbook; propose lessons only where
your task says to.

## Proof of work

- Before you say a task is done, run `pnpm lint`, `pnpm typecheck`, `pnpm test` and
  `pnpm check:assets`, and report each result. A failure is reported with its output, never
  summarised away. Fix its cause: do not loosen a test, a budget or a lint rule to make it pass.
- A check you could not run is reported as not run, never as passed. Code you could not execute
  (a Playwright spec, a shader) is unverified: say so, and say which command proves it.
- A bug fix starts with a test or reproduction you have seen fail.
- A ticket's acceptance criteria are the definition of done: list each one with how you met it.

## Never fake a measurement

Frame times, file sizes, scores, timings and counts are measured or reported as "not measured".
Never invent one, round one into a claim, copy one from another project, or record a budget from
a guess. A budget is recorded from a run (`pnpm perf:check --record`) or set by the owner.

## Look, motion and WebGL

You cannot see the page. For visual, motion and WebGL work, state what you changed and what you
could not verify, and ask for the owner's eyes before it is called finished. Do not add automated
specs for look, layout or motion (`CODING_STANDARDS.md`).

## Two tries, then ask

If two attempts at the same failure have not fixed it, stop. Report what you tried, what each
attempt showed and what you think is wrong, and ask for help. Do not try a third variation.

## Memory-heavy commands

Subagents and workers (e.g. under `/implement-spec`) must not start Next.js processes: no `next dev`,
`next build`, `next start`, `pnpm dev`, `pnpm build`, `pnpm start`, and no Playwright or browser runs (`pnpm smoke`, `pnpm perf`).
Parallel Next processes have crashed the dev machine. Workers verify with lint, typecheck and unit
tests only. Only the lead session runs `next build`, `next dev` and the browser suites, once, after
the workers have finished.

## House rules

Each one is an ADR in `docs/adr/`; read the ADR before working against it.

- `web` reads content through Payload's Local API, read-only, and has no `/admin` and no `/api`
  routes. Only `cms` writes (ADR-0002, `apps/web/src/routes.test.ts`).
- Content is visible without JavaScript. Motion enhances a complete page and never holds content
  back (ADR-0008).
- Every WebGL effect follows the engine contract in `packages/motion/README.md`: `ok: false` and
  plain HTML without WebGL2, rebuild after a lost context, a fresh canvas per effect run, faults
  through `reportMotionFault`. List its page in `EFFECT_PAGES` (`smoke/webgl.ts`).
- Fonts are defined only in `packages/ui/fonts.ts`. No SVG filters, no
  `:active-view-transition-type()` (`pnpm lint`).
- Images and static files come from the CDN prefix; the edge caches immutable files only
  (ADR-0006, ADR-0007). Mind the asset-weight budget (`scripts/assets-budget.ts`): re-encode a
  heavy file, do not raise the limit.
- Secrets stay on the server. Never commit one, never name one `NEXT_PUBLIC_*`, never pass a server
  value into a client component. A secret that reached a page or a bundle is rotated.
- Never edit a migration that has shipped. Seed text content only (ADR-0010).
- Delivery is by release tag only; never push to `main` and never skip a hook or a check
  (ADR-0005).
- Do not copy another project's design into the starter (`scripts/repo-guard.test.ts`).

## What CI checks

Every pull request and push to `main` runs `check` and `browser` (ADR-0005, ADR-0012). Run the
first two rows yourself; the rest need Docker and a browser, so the lead runs them.

| Check                             | Command                            | Where                                                 |
| --------------------------------- | ---------------------------------- | ----------------------------------------------------- |
| Lint, typecheck, unit tests       | `pnpm lint`, `typecheck`, `test`   | `infra/ci.sh check`                                   |
| Asset-weight budget               | `pnpm check:assets`                | `scripts/assets-budget.ts`                            |
| Route sweep, server HTML, headers | `pnpm smoke`                       | `smoke/smoke.spec.ts`, `smoke/routes.ts`              |
| Accessibility (axe, structure)    | `pnpm smoke`                       | `smoke/a11y.spec.ts`                                  |
| Secrets in the bundle             | `pnpm smoke`; guard in `pnpm test` | `smoke/secrets.spec.ts`, `scripts/public-env.test.ts` |
| WebGL DOM fallback                | `pnpm smoke`                       | `smoke/webgl-fallback.spec.ts`                        |

`smoke/checks.selftest.spec.ts` runs each browser check against a broken page. A new check gets a
unit test on broken input and a self-test; a gate that cannot fail proves nothing.

## Standards

Writing or changing tests or smoke specs: read `CODING_STANDARDS.md` first.

## Agent skills

### Issue tracker

Issues are local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), recorded as a `**Status:**` line in each issue file. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
