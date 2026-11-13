---
symptom: A step listed in the ticket's work was never done, and ticket QA passed it anyway; it only came up at the final QA rubric
detail: The ticket listed "set the fallback title in layout.tsx to the shop name" under Work but not under Acceptance criteria. Ticket QA checks the acceptance criteria and, without access to the branch's source, only what a visitor sees, so the starter's placeholder fallback title shipped. When writing a ticket, make every Work item that must land an acceptance criterion, worded so a visitor can check it on the preview (e.g. "a 404 page's title is the site name"), not only as a source edit.
cause: observed
fix-verified: Not verified. The fix was not applied in this project. The evidence is that ticket 01 named the step under Work, its QA passed it, and QA rubric-1 found the placeholder title still in layout.tsx.
date: 2026-11-13
form: rule
source: ticket 01-flower-shop-page, QA rubric-1
principle: What is not in the acceptance criteria is not checked; write each required step as a criterion a reviewer can see
applies-to: general
---
