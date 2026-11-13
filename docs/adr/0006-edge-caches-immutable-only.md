# 6. The CDN caches immutable files only; settings as code

Date: 2026-11-09 · Status: accepted

## Context
Caching HTML at the edge can serve pages that point at deleted chunks. Bot challenges can block
subresource requests, and the free plan cannot exempt paths from them. Script-rewriting features
inject or change scripts.

## Decision
- Cache `/_next/static/*` and media as immutable. Never cache HTML or RSC at the edge, so
  publishing needs no purge.
- Bot Fight Mode, Rocket Loader, Email Obfuscation and Always Online are off. Cloudflare's
  always-on DDoS protection stays.
- No rate limiting at the origin.
- The settings are applied by a script with an API token and documented in the repo.

## Consequences
Pages are rendered per request (`force-dynamic`) from data cached with `unstable_cache` and tagged,
so a save in the CMS invalidates exactly what changed and publishing needs no CDN purge. The origin
serves HTML from that cache, which is cheap for a site this size.
