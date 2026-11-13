---
author: qa
---

# QA rubric report

Merged main, commit ebda19a9aceac58490dd8ed41f8e226747524621, at https://emres-macbook-pro.tail201ea9.ts.net:4400/. Only the home page `/` exists on the preview; `/examples/glow` answers 404 (t7). Everything below was measured in one headless Chromium, in a lab run on this machine, not in the field.

## Tool runs

- t1: `browser_navigate` to `/` at the default desktop width, then `browser_evaluate` reading the navigation and resource timings, meta tags, headings, landmarks, images and JSON-LD.
- t2: `browser_evaluate` on `/` at desktop width: buffered `PerformanceObserver` for `largest-contentful-paint` and `layout-shift`, paint timings, computed fonts, link box sizes, horizontal overflow, response headers of `fetch('/')`, and `fetch` of `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest` and `/nonexistent-xyz`.
- t3: `browser_console_messages` at level warning, all messages since the session began.
- t4: `browser_resize` to 375 by 667, `browser_navigate` to `/`, then `browser_evaluate`: LCP and layout-shift observers, overflow, computed font sizes and colours, `document.getAnimations()`, the fetched CSS file, reduced-motion match.
- t5: `browser_take_screenshot` at 375 by 667, saved as `studio/qa/rubric-1-phone.png`.
- t6: `browser_evaluate` on `/` at 375 wide: contrast ratios computed from computed colours against white, background colours, focus on the mail link and its computed outline, skip-link and `role=alert` lookup.
- t7: `browser_navigate` to `/examples/glow` (status and title read from the tool result).
- t8: `browser_evaluate` installing an `event` `PerformanceObserver` (duration threshold 16 ms) and computing contrast against the real page background `rgb(250, 246, 251)`, then `browser_press_key` Tab, `browser_click` on `main`, then a second `browser_evaluate` reading the recorded events.
- t9: `browser_evaluate` reading the user agent and viewport.
- t10: Grep over `apps/` for animation, transition, media-query, WebGL, JSON-LD, robots, sitemap, manifest and font terms (count mode), and Grep of `apps/web/src/app/layout.tsx` for metadata.

## Performance (20)

- Score: 17 of 20 [t1, t2, t4]
- Largest contentful paint 176 ms and first contentful paint 176 ms on `/` at desktop width [t2]. The LCP element is text; the page has no images [t1].
- Time to first byte 135.5 ms, DOMContentLoaded 156.6 ms, load 179.4 ms, protocol h2 [t1].
- Eight resources with 142275 bytes transferred in all; the HTML document is 3153 bytes [t1]. Two script chunks of 64355 and 67353 bytes carry most of that for a page that shows static text and has no interactive control other than one mail link [t1].
- HTML is served with `cache-control: private, no-cache, no-store, max-age=0, must-revalidate` and gzip [t2]. Not measured: the immutable cache headers on `/_next/static` files, the CDN path, and a throttled-network run.
- No web fonts: the page uses the system font stack and `document.fonts` is empty [t2].
- Marks lost for shipping about 130 kB of script on a static page [t1].

## Mobile (20)

- Score: 16 of 20 [t2, t4, t5, t6]
- `viewport` meta is `width=device-width, initial-scale=1` [t1].
- At 375 wide the page scroll width equals the client width, 375 px: no horizontal overflow [t4]. At 1280 wide both are 1280 [t2].
- Body text is 16 px, the lead line 18 px, the footer 14 px, headings 36 px and 24 px [t4, t6]. The phone screenshot shows a single column with readable text and no clipping [t5].
- The only interactive element, the `mailto:` link, is 145 px wide and 18 px high [t4]. That is below a 24 px target height, so it is a small tap target on a phone [t4].
- Not checked: a real iPhone, safe-area insets, dynamic type, touch gestures, landscape, and widths other than 375 and 1280. Playwright's engine here is Chromium (HeadlessChrome 157), not an iPhone [t9].

## Semantics and SEO (20)

- Score: 13 of 20 [t1, t2, t10]
- `<html lang="en">`, a title `Lilac & Linden`, and a meta description of one sentence are present [t1].
- One h1, then two h2 (`Opening hours`, `Contact`), no skipped levels [t1]. Landmarks: one `main`, two `section` regions with accessible names, one `footer` [t1].
- Opening hours are a real `table` with `rowheader` and `cell`, not a div grid [t1].
- Missing: canonical link, Open Graph and Twitter tags, JSON-LD (a `LocalBusiness` block would fit this content) [t1]. The count of JSON-LD scripts is 0 [t1].
- `/robots.txt`, `/sitemap.xml` and `/manifest.webmanifest` all answer 404 [t2]. The 404 pages are served with status 404, which is right for a missing path [t2, t7].
- The `layout.tsx` default title is still the placeholder `Project name`; the home page overrides it, so the visible title is correct [t1, t10].

## Animation (15)

- Score: 5 of 15 [t4, t10]
- The page has no motion: `document.getAnimations()` returns 0 running animations after load [t4], no layout shift was recorded [t2, t4], and the source search found no WebGL or motion-library use on the home page [t10]. There is nothing to fail and nothing to credit, so most of this section's weight is not earned.
- Frame times: not measured.
- Easing, timing, polish and the reduced-motion treatment of any future effect: needs your eyes. The browser reported reduced motion as off during this run [t4].

## Markup (15)

- Score: 12 of 15 [t1, t4]
- Server HTML is small and semantic: 7987 characters in the serialised document, no images, no inline layout tables, native elements only [t1].
- Stylesheet is one Tailwind file of 6119 characters [t4].
- Not checked: W3C HTML validation (the browser reaches only the preview, so no validator could run), and the HTML with JavaScript off. The text of `main` is 208 characters in the live DOM [t9].
- Console: four errors, all `404` responses to my own probe requests (`/sitemap.xml`, `/manifest.webmanifest`, `/nonexistent-xyz`, `/robots.txt`); the page's own load logged none [t3].

## Accessibility (10)

- Score: 8 of 10 [t4, t6, t8]
- Contrast against the real background `rgb(250, 246, 251)`: headings and link 8.43 to 1, body text 14.24 to 1 [t8]. Both clear 4.5 to 1.
- The mail link is underlined and takes focus; its focus outline is the browser default, `auto 1px rgb(0, 95, 204)` [t6]. Tab from the page start was pressed once, and the focus ring was not captured in a screenshot, so how it looks is not judged [t8].
- The accessibility snapshot shows named regions, headings in order and a table with row headers [t1]. An empty `alert` node is in the tree; it is Next's route announcer and holds no text [t6].
- No skip link, and the page has one focusable element, so none is needed today [t6].
- Not run: axe, a screen reader, 200 percent zoom, forced colours.
- Marks lost for the 18 px link target and the unchecked items [t4, t6].

## Core Web Vitals

- LCP: 176 ms on desktop, a first load [t2]; 40 ms on the 375 wide reload, likely with a warm cache, so do not read it as a first-visit figure [t4]. Against under 2.5 s. Lab run only, no field data.
- CLS: 0, no `layout-shift` entry on desktop or phone [t2, t4]. Against under 0.1.
- INP: not measured as a real INP. In the one interaction I made (a click on `main`, preceded by one Tab press) every event entry reported a 16 ms duration with input delay under 2 ms [t8]; 16 ms is the observer's floor, so that is a ceiling on one click, not an INP. Against under 200 ms.

## Browsers

- Chrome latest: ran the whole report in HeadlessChrome 157.0.0.0 [t9].
- Chrome previous: not checked.
- Safari: not checked.
- Firefox: not checked.
- iOS Safari: not checked, needs your eyes on a real iPhone.
