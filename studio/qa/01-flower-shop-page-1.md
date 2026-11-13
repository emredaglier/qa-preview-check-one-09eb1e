---
author: qa
verdict: pass
---

# QA: 01-flower-shop-page, commit 4a2385f

Tested at https://emres-macbook-pro.tail201ea9.ts.net:4400/ in the browser tools (Chromium engine), at 1440x900 and 390x844. I tested only what a visitor gets. I could not read the branch's source, see "Not checked".

## Checked, passes

- **Content on `/`** (accessibility snapshot, `browser_snapshot`, and the page screenshots): the h1 "Lilac & Linden", the tagline, the intro, the hours, "Alsancak, İzmir" as text, `hello@example.com` as a link to `mailto:hello@example.com`, and the footer note "A sample site: this shop is fictional." All are present and spelled as in the ticket, including İ and the en dash in 09:00–19:00.
- **With JavaScript off:** I could not switch JS off in the browser tools. I read the server response body of the first request for `/` (`browser_network_request`, response-body). The HTML already holds all of the content above, so none of it depends on JS. Title is `Lilac & Linden`. The meta description is the ticket text.
- **Nothing extra on the page:** the snapshot and the server HTML have no phone number, form, map, iframe, image or canvas. The network list for the page (`browser_network_requests`) shows one document, one CSS file and Next's JS chunks. It shows no image or font request. I saw no motion while the page loaded.
- **`/examples/glow`:** the page returns HTTP 404 and shows "Page not found" (`browser_navigate`).
- **Structure:** one `main` landmark, one h1, then two h2 ("Opening hours", "Contact"), in order. The hours are a real `table` with row headers ("Monday to Saturday", "Sunday") and cells. The footer is a `contentinfo` landmark outside `main`. Each section is a region named by its heading.
- **Phone width (390 px):** full-page screenshot `studio/qa/01-flower-shop-page-1-phone.png`. Text wraps, nothing is cut off, no horizontal scroll is visible, and the table stays readable. Desktop screenshot: `studio/qa/01-flower-shop-page-1-desktop.png`.
- **Console on `/`:** one error, `GET /favicon.ico` 404. The ticket does not ask for a favicon, and I cannot tell from here whether main has one. I report it and do not bounce on it.

## Not checked

- **Source-level criteria.** "No source file outside test fixtures names the example effect" and "lint, typecheck, test and check:assets pass" are not verified by me. My shell cannot read the ticket branch: the sandbox hook blocked `git`, and the `studio` worktree holds main's files, not the branch's. CI is reported green, and `pnpm smoke` is the lead's. The diff stat lists the glow files as deleted, but I did not read what is left behind.
- **Smoke checks left with nothing to check** (the ticket asks workers to report these): not checked, no branch source.
- **Look:** unverified until the owner sees it at G4. The screenshots only show that nothing is broken.
- **Safari and iPhone:** not checked. I tested only in the Chromium engine.
- No numbers (sizes, timings) are in this report, because I measured none.

## Verdict

Pass for everything a visitor can see on the preview. The two source-level criteria above need the lead's eyes.
