# 1. A pnpm monorepo: web app, CMS app, CMS config, motion and UI packages

Date: 2026-11-09 · Status: accepted

## Context
A house project needs the same backbone every time: a public site, a private CMS, shared content
configuration, a motion toolkit and a place for the design. Starting each project from an empty
folder repeats the same decisions, and a long unstructured session grows wiring that is hard to
follow.

## Decision
- One repo, pnpm workspaces: `apps/web`, `apps/cms`, `packages/cms-config`, `packages/motion`,
  `packages/ui`. No Turborepo. Three top-level folders are not workspace packages: `infra/` (the
  deploy scripts and per-project settings), `smoke/` (the release gate, run against the built
  image) and `perf/` (the local frame-time suite).
- `packages/ui` starts as an empty shell: no tokens, fonts, colours or components. Each project
  fills it with its own design. `packages/motion` starts with plumbing only; the effects library
  starts empty and grows as projects finish.
- Stack: Next.js 16, React 19, Payload 3, TypeScript strict, Tailwind v4, Vitest, ESLint plus the
  `check-effects` script. `packages/motion` depends on GSAP (the ticker) and draws its effects with raw WebGL2.
- Fonts use `next/font`, defined only in `packages/ui/fonts.ts`. A repo test fails if they are
  defined anywhere else.
- Node and pnpm are pinned (`.node-version`, `engines`, `packageManager`), and pnpm's minimum
  release age is set so a freshly compromised release has time to be caught.
- A repo guard test (`scripts/repo-guard.test.ts`) fails if another project's identity, fonts,
  colours, tokens, copy or effect names appear in the starter or in a project made from it.

## Consequences
A new project installs, passes `pnpm check` and serves a placeholder page on its first day. The
workspace package scope (`@house/*`) is renamed per project.
