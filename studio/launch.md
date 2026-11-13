---
author: producer
---

# Launch notes

- 2026-11-13: the owner approved G5 launch, attempt 1, with no notes. That approval is the launch (plan, decision 5).
- The orchestrator tagged the release `v1.0.0`.
- Preview: https://emres-macbook-pro.tail201ea9.ts.net:4400/
- Nothing is deployed: no production host, domain, DNS, redirects, analytics or error monitor. Rollback trigger: none.
- Launched six days ahead of the planned launch date of 2026-11-20.

## Left open at launch (the owner accepted these with the go)

- CI `check` and `browser` on `main` at `ebda19a`: no result was seen before the go.
- QA rubric: attempt 1 scored 71/100 and attempt 2 is in `studio/qa/rubric-2.md`. The orchestrator logged both as not accepted, and neither named a blocker.
- QA findings: the `mailto:` link's tap target is 18 px, the page ships about 130 kB of script, SEO extras are missing, and the default title in `layout.tsx` is still `Project name` (a 404 page may show it).
- Safari (macOS, iOS) and Firefox: the owner checks these. I have no record of the result.

## Next

- Retro: when asked, write candidate lessons to `studio/retro/producer-1.md`.
- Any of the findings above needs a new ticket, and the owner's say, because the brief's two-ticket cap is used up.
