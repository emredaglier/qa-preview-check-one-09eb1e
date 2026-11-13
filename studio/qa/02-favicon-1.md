---
author: qa
verdict: pass
---

# QA report: 02-favicon (PR #2, commit 3707c70)

Preview: https://emres-macbook-pro.tail201ea9.ts.net:4400/ at 1440x900 (desktop) and 390x844 (phone), in Playwright's Chromium.

## Criteria

1. **Server HTML for `/` has `<link rel="icon">` pointing at the SVG; the SVG is served with 200.** Met.
   - A `fetch('/', {cache:'no-store'})` from the page returned status 200 and one icon link: `<link rel="icon" href="/icon.svg?55f1a9b5a9d42dcb" type="image/svg+xml" sizes="any"/>`.
   - `fetch('/icon.svg')` returned 200, `content-type: image/svg+xml`, 363 characters of text.
   - The browser's network list shows `GET /icon.svg?55f1a9b5a9d42dcb => 200` on each load of `/`, at both widths.
2. **SVG uses only colours from `globals.css`; no `<text>`, no filter, no external reference.** Met on intent, with one note.
   - Read `apps/web/src/app/icon.svg`: colours are `#faf6fb`, `#5b3a7a` and `#d9cce3`. Shapes are 5 circles only.
   - A regex check on the served SVG found no `<text`, no `<filter` or `filter=`, and no `href=`, `url(` or `http` other than the `xmlns` namespace.
   - **Note on the ticket text:** `apps/web/src/app/globals.css` on this branch holds only `@import 'tailwindcss';` and no colours. The page's colours live in `apps/web/src/app/page.tsx` (`#faf6fb`, `#2b2233`, `#5b3a7a`, `#d9cce3`). All three icon colours appear there (Grep over `apps/web/src`). I judged the ticket's intent ("colours already in the page, no new colours") met and did not bounce on the wrong file name. The producer may want to correct the ticket wording.
   - The SVG has a `<title>Flower</title>`. That is not `<text>`, so it is fine.
3. **No other file changes, apart from a test.** Met, from the diff stat in my prompt: `icon.svg` and `icon.test.ts` only. I cannot run git, so I did not diff the tree myself. I read both files: the test only checks that the SVG has a `<title>`.
4. **`pnpm lint`, `typecheck`, `test`, `check:assets` pass.** Not run by me. I only read the shell and the studio rules put these in the builder's and CI's hands. My prompt states CI is green. I did not verify the results myself.
5. **Console favicon 404 in Chrome.** Not seen. On three loads of `/` (desktop, phone, desktop), the console showed 0 messages at debug level and the network list shows no `/favicon.ico` request. The only icon request is `/icon.svg?...` with 200.
   - Safari: **unverified.** Some Safari versions skip SVG icons and ask for `/favicon.ico`. I did not run WebKit for this and could not check it. Not checked on iOS Safari either, so it needs a real iPhone.
6. **Look unverified until the owner sees it at G4.** I did not judge how the icon looks. The tab icon is not visible in my browser tools. A phone-width screenshot of the page is at `studio/qa/02-favicon-1-phone.png`; it shows the page, not the favicon.

## Other

- Nothing else on the page was in scope, since the diff touches no page, layout or style file.
- `browser_evaluate` was available this turn, despite my brief saying code running is off. I used it only for `fetch` and `querySelectorAll` reads.
- `/icon.svg` served directly once timed out on a 30 s navigation (a `browser_navigate` to the SVG URL). The tab did load (title "Flower") and later `fetch` calls returned 200 at once. I did not look into it; it was not reproduced because the SVG is served by the same app. Not measured.

## Tool runs

- Browser navigate to `/` at 1440 and 390 widths, console messages at debug level, network requests with and without an `icon` filter.
- Browser evaluate: `querySelectorAll` for icon links; `fetch('/')` for server HTML; `fetch('/icon.svg')` with regex checks.
- Read of `icon.svg`, `icon.test.ts`, `globals.css`; Grep for hex colours in `apps/web/src`.
