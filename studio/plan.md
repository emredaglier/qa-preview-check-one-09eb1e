---
author: producer
---

# Plan: QA preview check (flower shop, one page)

## What gets built

- One page at `/` for a fictional flower shop in Alsancak, İzmir: hero, opening hours, contact.
- Hero text comes from the starter's Site global (name, tagline, intro), with new seed text. No new CMS fields and no migration.
- Hours and contact are written in the page code.
- The starter's example effect (`/examples/glow`) is deleted, so the site has one page.

## Decisions (brief grill R1, owner: yes all)

- Fictional shop with sample content written by the studio. Email on `example.com`, address at district level only, no phone number.
- English only (`lang="en"`).
- Contact details are shown only: `mailto:` link, no form, no map embed.
- Plain look: text-only hero, system fonts, a few colours, no motion, no WebGL, no images.
- Launch is the G5 go on the preview. No production deploy, domain, analytics or error monitor. The starter rename (`@house/*`, `reportFault`) is skipped.
- G5 browsers: current Chrome, Safari (macOS, iOS) and Firefox at phone and desktop widths. The owner checks the look in Safari and Firefox.
- Producer's call, open to change at G4: a one-line footer note says the shop is fictional, so the sample details are not taken for a real business.

## Phases and gates (thin-slice)

- Brief intake (done), build, G4 working build, QA, G5 launch.

## Tickets

- `01-flower-shop-page`: standard, frontend. The page, seed text and deletion of the example effect.
- `02-favicon`: standard, frontend. SVG favicon in the site's colours. The owner asked for it after QA found a favicon 404. This uses the brief's second and last ticket slot.

## Gate criteria

### G4 working build

- Tickets 01 and 02 are merged.
- `/` shows the hero, opening hours and contact, and is complete with JavaScript off.
- The site has one public page: `/examples/glow` is gone and the route sweep finds only `/`.
- `pnpm lint`, `typecheck`, `test`, `check:assets` and `smoke` pass on the merged build.
- The page has no phone number, form, map, image or motion.

### G5 launch

- The QA report is written and has no open QA blocker.
- CI `check` and `browser` are green on the build under review.
- Go/no-go is complete: browsers as decided; redirects, analytics and DNS not applicable; rollback trigger "none, nothing is deployed".
- No starter placeholder text is left on the page or in the page title.
- Every G4 condition is met.

## Schedule

- Start: 2026-11-16
- G4 working build: 2026-11-17
- G5 launch: 2026-11-19
- Launch: 2026-11-20

Worked back from launch: one day for the owner's go, one day of QA after G4, one day for the owner's G4 review, one day of build.
