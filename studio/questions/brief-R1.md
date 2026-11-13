---
author: producer
---

# Brief grill, round 1

Already settled by the brief:
- One page with a hero, opening hours and contact.
- Thin-slice profile: gates G4 and G5.
- Launch on 2026-11-20.
- Two small tickets at most.
- No CMS content beyond the starter's Site global (name, tagline, intro). So hours and contact go in the page code: no new CMS fields, no migration.

Answer `yes all`, or by number.

❓ **Q1** - **Placeholder content**: The brief gives no shop name, hours, address or contact details, and the studio does not make up facts. Is the shop fictional, with sample content the studio writes?
- Shop name and tagline: seed text in the Site global.
- Opening hours: sample hours.
- Contact: an address at district level only ("Alsancak, İzmir") and an email on the reserved `example.com` domain. No phone number, because a made-up number may belong to a real person.

If not, send the real details.

➡️ Yes: the shop is fictional, the studio writes the sample content, the email is on `example.com` and there is no phone number.

---

❓ **Q2** - **Language**: Is the site in English only (`lang="en"`), with no Turkish version and no language switch?

➡️ Yes: English only.

---

❓ **Q3** - **Contact section**: Does the contact section only show details, with no form and no map?
- Address as text, email as a `mailto:` link.
- No contact form. A form needs a backend route, spam handling and a privacy notice, and `web` has no `/api` routes (ADR-0002).
- No embedded map. A third-party embed sets cookies.

➡️ Yes: details only, no form, no map embed.

---

❓ **Q4** - **Look and motion**: The thin slice has no design phase. Is the look the studio's call, which you see first at G4, kept plain?
- A text-only hero, with no photos (so no licensing and no asset-budget work).
- The system font stack and a small set of colours.
- No motion and no WebGL. The starter's example effect (`/examples/glow`) is deleted, so the site really is one page.

➡️ Yes: plain text hero, system fonts, no motion, example effect deleted.

---

❓ **Q5** - **What launch means**: Is "launch" on 2026-11-20 your G5 go on the preview build, with no production deploy?

A real deploy would need a domain, a server, Cloudflare and R2. It would also need `infra/project.env` filled in (it still holds the placeholder `example.com`, which the deploy refuses) and a release tag cut by you.

With no deploy:
- The G5 go/no-go marks DNS, redirects and analytics as not applicable.
- The rollback trigger is "none, nothing is deployed".
- The starter's rename steps are skipped: the `@house/*` scope stays, and `reportFault` keeps logging only, with no error monitor.

If you want a real deploy, answer no, and round 2 asks about the domain, server, analytics and error monitor.

➡️ Yes: no production deploy, launch is the G5 go on the preview, no domain, no analytics, starter rename skipped.

---

❓ **Q6** - **Browsers at G5**: Does G5 check the current Chrome, Safari (macOS and iOS) and Firefox, at phone and desktop widths?
- The smoke suite covers Chromium automatically.
- Agents cannot see the page, so the look in Safari and Firefox needs your eyes at G5.

➡️ Yes: current Chrome, Safari (macOS, iOS) and Firefox, phone and desktop. The look in Safari and Firefox is checked by you at G5.
