# House starter

The house backbone as a template: a pnpm monorepo with a public Next.js site, a private Payload
CMS, shared CMS config, a minimal motion package and an empty UI package. It carries no design: no
tokens, fonts, colours, components or copy.

- Decisions: [`docs/adr/`](docs/adr/). Coding standards: [`CODING_STANDARDS.md`](CODING_STANDARDS.md).
  Rules for agents (house rules, proof of work, the playbook rule): [`AGENTS.md`](AGENTS.md).

## Setup

Node and pnpm are pinned (`.node-version`, `engines`, `packageManager`). With Corepack enabled:

```sh
pnpm install
pnpm check   # lint, typecheck, test, build
```

To see the placeholder page locally:

```sh
cp apps/cms/.env.example apps/cms/.env && cp apps/web/.env.example apps/web/.env
pnpm migrate   # creates apps/cms/data/site.db
pnpm seed      # fills the placeholder Site global
pnpm dev       # web on http://localhost:3000
pnpm --filter @house/cms dev   # the admin on http://localhost:3001/admin
```

To serve a production build of the web app instead:

```sh
pnpm build
pnpm start                                  # next start on http://localhost:3000
pnpm start --port 4400 --hostname 127.0.0.1   # flags pass through to next start
```

## Layout

| Path                  | Role                                                                               |
| --------------------- | ---------------------------------------------------------------------------------- |
| `apps/web`            | Public Next.js site: Local API reads, no `/admin`, no `/api`                       |
| `apps/cms`            | Payload admin, the only writer of the database                                     |
| `packages/cms-config` | Payload collections, globals, access, revalidation, seed and migrations            |
| `packages/motion`     | Motion plumbing, the WebGL engine contract and one example effect                  |
| `packages/ui`         | Empty shell: head script and the single place fonts are defined                    |
| `infra`               | Docker Compose, Caddy, Litestream, deploy scripts, per-project settings            |
| `smoke`               | The browser gate on every PR and release: Playwright against the built `web` image |
| `scripts`             | Repo checks: effects lint, the asset-weight budget (`pnpm check:assets`)           |

`pnpm lint` also runs `scripts/check-effects.mjs`, which rejects SVG filters and
`:active-view-transition-type()` (see the comment at the top of the script).

## Infra and releases

[`infra/`](infra/README.md) carries the deploy backbone (Docker Compose and Caddy, CI-built images, health-gated deploys with automatic rollback, SQLite WAL with Litestream to R2, static files on R2 behind Cloudflare, admin and draft preview on Tailscale only). Every per-project name (domain, CDN host, buckets, server folder) comes from [`infra/project.env`](infra/project.env); the README there lists what the owner fills in. CI builds images and deploys only from a release tag (`v1.2.3`); pull requests and `main` run lint, the asset-weight budget, typecheck and unit tests, and the browser checks against the built `web` image (ADR-0012).

`pnpm smoke` is the browser gate: the route sweep, accessibility, secrets in the bundle, the WebGL DOM fallback and the request-level checks (it needs Docker and a Playwright Chromium; see "Smoke gate" in `infra/README.md`). Workers do not run it: the lead runs it once, after the workers finish.

## Perf

Local only; never in CI, because CI runners have no GPU. Needs the Playwright browsers once
(`pnpm exec playwright install chromium webkit`).

```sh
PERF_BASE_URL=http://localhost:3000 pnpm perf   # measure a production site that is already running
pnpm perf                                       # or build and serve the image through the smoke runner, then measure
pnpm perf:check                                 # compare perf/.output/report.json to perf/perf-budget.json
pnpm perf:check --record                        # write a new budget from the latest report (2x headroom)
```

`pnpm perf` records frame times (p50, p95, worst, share of dropped frames) for each scenario in
`perf/scenarios.ts` in Chromium at 4x CPU throttle and in WebKit, then samples main-thread CPU and
`requestAnimationFrame` callbacks per second with no input on the page named by `IDLE_PATH` in
`perf/scenarios.ts` (the example effect's page), after its idle timeout (Chromium). The idle check
is skipped with a notice when `IDLE_PATH` is `null`. A scenario whose feature is not on the page is skipped with a notice. A
new effect adds its scenario by editing the registry and putting the element named in `requires`
on its page. Headless browsers have no GPU, so numbers only mean something against an earlier run
on the same machine: run `pnpm perf` on the base commit, copy `perf/.output/report.json` aside,
run it again with the change and compare.

## Starting a project from the template

1. Create the project repo from the template, then fill in `infra/project.env` and follow the
   checklist at the top of `infra/README.md`.
2. Rename the `@house/*` scope in every `package.json`, import and `transpilePackages` list. Also
   rename the `house:motion-fault` event (`packages/motion/src/fault.ts`), the email adapter's
   `defaultFromName` (`packages/cms-config/src/config.ts`) and the `'Project name'` title in
   `apps/web/src/app/layout.tsx`. Fill in `reportFault` in `apps/web/src/lib/observability.ts`
   (it only logs now) to send motion faults to the project's error monitor. Call `configureIdle`
   with the project's idle timeouts if it has route-specific ones.
   Delete the example effect you do not keep. Every place that names it:
   - `packages/motion/src/glow` and its `@house/motion/glow` export in `packages/motion/package.json`;
   - `apps/web/src/app/examples/glow`;
   - `/examples/glow` in `EFFECT_PAGES` in `smoke/webgl.ts` (its page is found by the route sweep
     on its own, and goes with the folder);
   - the `glow-sweep` scenario and `IDLE_PATH` in `perf/scenarios.ts` (point `IDLE_PATH` at the
     project's own looping page, or set it to `null` to skip the idle check);
   - the `glow-sweep` keys in `perf/perf-budget.json` (a test fails while a budget names a missing
     scenario), then record a new budget with `pnpm perf:check --record`.
3. Replace `packages/cms-config/src/seed/placeholder.ts`, the Site global and the home page with the
   project's content model.
4. Fill `packages/ui` with the project's design (tokens, fonts in `packages/ui/fonts.ts`).
5. Keep `scripts/repo-guard.test.ts`: it fails if another project's design leaks in.

## Infra decisions

ADRs 0002 to 0007, 0009 and 0011 describe the rules that infra meets.
