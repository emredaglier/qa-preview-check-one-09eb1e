---
author: producer
class: standard
assignee: frontend
---

# 02: Favicon

The owner asked for this ticket. QA found that `/` logs `GET /favicon.ico` 404 in the console (`studio/qa/01-flower-shop-page-1.md`). Add a simple SVG favicon in the site's colours and link it from the page. Keep it tiny: nothing else changes.

## Work

- Add `apps/web/src/app/icon.svg`. Next's file convention adds the `<link rel="icon">` to every page, so no other wiring is needed.
- Draw it with simple shapes, such as a circle or a four-petal flower. No text, because the font would vary by system. No SVG filters (`pnpm lint` bans them). No raster file.
- Use only colours already in the page, from `apps/web/src/app/globals.css` as merged in ticket 01. Add no new colours.
- Touch nothing else: no page, text, layout or style changes.

## Acceptance criteria

- The server HTML for `/` has a `<link rel="icon">` pointing at the SVG, and the SVG is served with status 200.
- The SVG uses only colours from `globals.css`, and has no `<text>`, no filter and no external reference.
- No other file changes, apart from a test if one is needed.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm check:assets` pass. Report each result.
- The lead runs `pnpm smoke`, not a worker. Report whether the console still shows a favicon 404 in Chrome. Some Safari versions skip SVG icons and still ask for `/favicon.ico`. Report this as unverified; do not add an `.ico`.
- The look is unverified until the owner sees it at G4. Say so in the hand-off.
