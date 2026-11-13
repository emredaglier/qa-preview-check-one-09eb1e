---
author: qa
---

# QA rubric report

Merged main, commit ebda19a9aceac58490dd8ed41f8e226747524621, at https://emres-macbook-pro.tail201ea9.ts.net:4400/. Everything below was measured in one headless Chromium on this machine: a lab run, not field data. I cannot read from the preview which commit it runs. The checkout names a `/examples/glow` page that the preview answers 404 for (see Animation), so the preview and the checkout may not be the same build. Numbers from an earlier report are not reused; every figure comes from a run listed here.

## Tool runs

- t1: `browser_navigate` to `/` at the default desktop width.
- t2: `browser_evaluate` on `/` at desktop width: navigation, resource and paint timings, buffered `largest-contentful-paint` and `layout-shift` observers, head tags, headings, JSON-LD count, `fetch` of `/`, `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest`, `/favicon.ico` and `/icon.svg` (status and cache headers), user agent, overflow, `document.fonts`, `document.getAnimations()`.
- t3: `browser_evaluate` on `/` at desktop width: `fetch` of the CSS file and the largest script chunk (cache headers), `fetch` of the raw server HTML (searched for h1, table, mailto, canonical, Open Graph, title), the CSS text (media queries, keyframes, transitions), computed fonts, sizes and colours, link box size, count of focusable elements, reduced-motion match.
- t4: `browser_resize` to a phone viewport.
- t5: `browser_navigate` to `/` at phone width.
- t6: `browser_evaluate` at phone width: overflow, LCP and layout-shift observers, resource count and transfer. Its contrast ratios were computed against a transparent background and are discarded; t8 replaces them.
- t7: `browser_take_screenshot` at phone width, saved as `studio/qa/rubric-2-phone.png`.
- t8: `browser_evaluate` at phone width: walked up from the h1 to find the real background colour, then computed contrast ratios against it.
- t9: `browser_evaluate` installing an `event` `PerformanceObserver` (duration threshold at its minimum).
- t10: `browser_press_key` Tab once.
- t11: `browser_take_screenshot` at phone width after the Tab, saved as `studio/qa/rubric-2-focus.png`.
- t12: `browser_evaluate` reading the focused element, its computed outline and `:focus-visible`, and the event entries so far.
- t13: `browser_console_messages` at level warning, all messages since the session began.
- t14: `browser_click` on `main`.
- t15: `browser_evaluate` reading the recorded event entries after the click.
- t16: Grep over `apps/` for animation, transition, WebGL, motion-library, JSON-LD, robots, sitemap, manifest, Open Graph, canonical and font terms, content mode.
- t17: Glob of `apps/web/src/app/**/*`.
- t18: `browser_navigate` to `/examples/glow`.
- t19: Read of `apps/web/src/app/examples/glow/page.tsx`.

## Performance (20)

- Score: 17 of 20 [t2, t3, t6]
- Largest contentful paint 56 ms on `/` at desktop width, first contentful paint 56 ms; the LCP element is the h1 and the page has 0 images [t2]. On the phone-width reload LCP was 36 ms on a `P` element, a reload with a probably warm cache, so not a first-visit figure [t6].
- Time to first byte 27 ms, DOMContentLoaded 45.3 ms, load 67.1 ms, protocol h2; the HTML document is 2854 bytes encoded [t2].
- Eight resources, 142275 bytes summed from their transfer sizes. Two script chunks of 67353 and 64355 bytes are almost all of it, for a page of static text with one link and no interaction code of its own [t2]. A 3621-byte `not-found` chunk also loads on the home page [t2]. Marks lost for the script weight.
- Static files: the CSS and the script chunk answer 200 with `public, max-age=31536000, immutable` and gzip [t3]. The HTML answers with `private, no-cache, no-store, max-age=0, must-revalidate` and gzip [t2].
- No web fonts: `document.fonts` holds 0 entries and the stack is the system stack [t2, t3].
- Not measured: a throttled network, a cold first visit, the CDN path.

## Mobile (20)

- Score: 16 of 20 [t3, t6, t7, t8]
- The `viewport` meta is `width=device-width, initial-scale=1` [t2].
- At phone width the scroll width equals the client width, 375 px, so no horizontal overflow; at desktop both are 1280 [t2, t6]. The opening-hours table is 311 px wide on the phone [t6].
- Type sizes: h1 36 px, lead paragraph 18 px, footer 14 px [t3]. The phone screenshot shows one column, readable text, no clipping [t7].
- The only interactive element, the `mailto:` link, is 145.17 px wide and 18 px high [t3, t6]. That is a small tap target on a phone. Marks lost for it.
- The CSS has no media queries; the layout is fluid and held at both widths I tried [t3, t7]. Widths other than the two used are not checked.
- Not checked: a real iPhone, safe-area insets, dynamic type, touch gestures, landscape. The engine here is HeadlessChrome 157 [t2], not an iPhone.

## Semantics and SEO (20)

- Score: 13 of 20 [t2, t3, t16]
- `<html lang="en">`, a title `Lilac & Linden` and a one-sentence meta description are present in the server HTML [t2, t3].
- One h1, then two h2 (`Opening hours`, `Contact`), no skipped levels [t2]. The accessibility snapshot shows a `main`, two named regions, a `contentinfo` footer, and the hours as a real `table` with `rowheader` and `cell` [t1].
- The raw server HTML already holds the h1, the table and the mailto link, so the content does not depend on JavaScript [t3].
- Missing: canonical link and Open Graph tags are absent from the server HTML [t3]; the JSON-LD script count is 0 [t2]. No code for them in `apps/` [t16].
- `/robots.txt`, `/sitemap.xml` and `/manifest.webmanifest` answer 404, and so does `/favicon.ico`; the icon is served as `/icon.svg` with 200 [t2]. No robots, sitemap or manifest code in `apps/` [t16].

## Animation (15)

- Score: 4 of 15 [t2, t3, t16, t18, t19]
- The home page has no motion: 0 running animations after load [t2], and the stylesheet holds no keyframes, transitions or animations [t3]. No layout shift entry was recorded on desktop or phone [t2, t6]. Nothing fails, and nothing is earned.
- The only effect in the checkout is the WebGL2 glow example at `/examples/glow`, with a plain-HTML fallback by its source comment [t17, t19]. On the preview it answers 404 (`Not found` title) [t18]. I could not exercise the effect, its fallback, or a lost-context rebuild; the effect is unverified here. Whether the preview build lacks the route or the route is gated is not something I could tell from the page.
- Frame times: not measured.
- Easing, timing, polish and the feel of any motion: needs your eyes. Reduced motion read as off during this run [t3].

## Markup (15)

- Score: 12 of 15 [t2, t3, t13]
- The server HTML is 7924 characters, semantic and native: no images, no div-grid table, no inline layout markup seen in the snapshot [t1, t3]. The stylesheet is one file of 6119 characters [t3].
- Console: 4 errors, all 404 responses to my own probe requests; the page load itself logged none [t13]. The glow probe added one more 404 error in the console [t18].
- Not checked: W3C HTML validation (the browser reaches only the preview, so no validator ran). Marks lost for that and for the unvalidated markup.

## Accessibility (10)

- Score: 8 of 10 [t3, t8, t11, t12]
- Contrast against the real background `rgb(250, 246, 251)`: headings and the link 8.43 to 1, body text and footer 14.24 to 1; both clear 4.5 to 1 [t3, t8].
- One Tab press moved focus to the mail link, which matches `:focus-visible` with an outline of `auto 1px rgb(0, 95, 204)` and offset 1px [t10, t12]. The screenshot shows a visible blue ring around the link [t11].
- The link is also underlined, so it is not marked by colour alone [t7].
- Page has 1 focusable element, so no skip link is needed today [t3].
- Marks lost for the small link target and for the checks not run: axe, a screen reader, 200 percent zoom, forced colours.

## Core Web Vitals

- LCP: 56 ms on desktop in a first load, 36 ms on the phone-width reload (probably warm cache). Lab run only, no field data [t2, t6].
- CLS: 0, no `layout-shift` entry on desktop or phone [t2, t6].
- INP: not measured as a real INP. In one Tab press and one click the event entries all report a 16 ms duration, the observer's floor, with input delay under 1 ms; that is a ceiling on one click, not an INP [t9, t12, t15].

## Browsers

- Chrome latest: ran the whole report in HeadlessChrome 157.0.0.0 [t2].
- Chrome previous: not checked.
- Safari: not checked.
- Firefox: not checked.
- iOS Safari: not checked, needs your eyes on a real iPhone.
