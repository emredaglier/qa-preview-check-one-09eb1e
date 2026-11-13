---
symptom: A contrast check in a QA or audit report passes or fails by a wide margin, but the ratio looks wrong for the colours on screen
detail: Reading `getComputedStyle(el).backgroundColor` on a text element usually returns `rgba(0, 0, 0, 0)` (transparent), because the page colour sits on an ancestor such as `body` or `html`. A ratio computed against that value is meaningless. Before computing any contrast, walk up from the element through `parentElement` until a background alpha above 0 is found, and use that colour. Flatten semi-transparent layers over the colour beneath them. Check the result against the screenshot. Record the background colour you found next to each ratio, so a reader can see what it was measured against. Discard any earlier figure taken against a transparent background and say so in the report.
cause: observed
fix-verified: In a rubric run the first contrast script read a transparent background and its ratios were thrown out. A second page script walked up from the h1 to the real background, `rgb(250, 246, 251)`, and gave 8.43 to 1 for headings and the link and 14.24 to 1 for body text. Those ratios are the ones in the report.
date: 2026-11-13
form: check
source: commit ebda19a (rubric report on merged main)
principle: A measurement is only as good as the input it reads. Check what the tool read before trusting the number it returned.
applies-to: general
---
