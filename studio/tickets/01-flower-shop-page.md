---
author: producer
class: standard
assignee: frontend
---

# 01: Flower shop page

Build the one-page site at `/` for a fictional flower shop and delete the starter's example effect. See `studio/plan.md` (Decisions).

## Content (sample, fictional)

- Name: `Lilac & Linden`
- Tagline: `Seasonal flowers in Alsancak, İzmir.`
- Intro: `Bouquets, plants and table flowers, made to order.`
- Description (meta): `Lilac & Linden, a fictional flower shop in Alsancak, İzmir: opening hours and contact.`
- Opening hours: Monday to Saturday 09:00–19:00, Sunday closed.
- Contact: `Alsancak, İzmir` as text, `hello@example.com` as a `mailto:` link.
- Footer note: `A sample site: this shop is fictional.`

## Work

- Replace the text in `packages/cms-config/src/seed/placeholder.ts` with the name, tagline, intro and description above. Seed text only: no schema change and no migration (ADR-0010).
- `apps/web/src/app/page.tsx`: hero from the Site global, then the hours and contact sections and the footer note, written in the page code. All of it is server-rendered (ADR-0008).
- Set the fallback title in `apps/web/src/app/layout.tsx` to the shop name. Skip the rest of the starter rename.
- Plain look: system font stack (fonts only in `packages/ui/fonts.ts`), a few colours, no images, no motion, no WebGL.
- Delete the example effect from every place listed in `README.md`, "Starting a project" step 2: `packages/motion/src/glow` and its export, `apps/web/src/app/examples/glow`, the `EFFECT_PAGES` entry, the `glow-sweep` scenario, `IDLE_PATH` set to `null`, and the `glow-sweep` keys in `perf/perf-budget.json`. Do not record a budget by hand.
- Update the tests that name the old placeholder text or the example page.

## Acceptance criteria

- `/` shows the name, tagline, intro, hours, address, email link and footer note, all present with JavaScript off.
- No phone number, form, map embed, image, motion or WebGL on the page.
- `/examples/glow` returns 404, and no source file outside test fixtures names the example effect.
- Headings are in order, there is one `main` landmark, and the hours read clearly as a list or table.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm check:assets` pass. Report each result.
- The browser suites (`pnpm smoke`) are run by the lead, not a worker.
- If removing the example leaves a smoke check or self-test with nothing to check, report it. Do not delete or loosen the check.
- The look is unverified until the owner sees it at G4. Say so in the hand-off.
