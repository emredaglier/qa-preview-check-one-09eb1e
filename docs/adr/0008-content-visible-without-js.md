# 8. Content is visible without JS; motion only enhances it

Date: 2026-11-09 · Status: accepted

## Context
Content that stays hidden until React hydrates, with only a long failsafe, makes any JS failure
look like a blank site.

## Decision
- Server HTML is fully visible on its own: pages are rendered on the server from the Local API.
- A tiny inline head script sets `html[data-js]` (`packages/ui/src/head-script.ts`). Entrance start
  states apply only under that attribute.
- A CSS failsafe releases every hold after a couple of seconds.
- An overlay such as an opening animation covers content; it does not hide it, and it has a hard cap.
- Images never depend on React state to become visible.
- Check the response body as well as the status: an unknown dynamic route must answer 404 with a
  server-rendered body, not an empty error shell that only fills in once JS runs. Rewrite unknown
  slugs to the root not-found page in the proxy rather than relying on `notFound()` alone.

## Consequences
When JS fails, the site degrades to a static site instead of a blank one. Entrances must set their
start states before first paint under `data-js`. The starter's placeholder page is the reference:
a test renders it to plain HTML and asserts its content.
