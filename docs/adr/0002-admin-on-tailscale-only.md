# 2. Separate the public site from the admin; admin reachable only over Tailscale

Date: 2026-11-09 · Status: accepted

## Context
An admin at a public `/admin` and a public Payload REST API widen the attack surface of what is
otherwise a set of mostly static pages.

## Decision
- `apps/web` is public. It reads content through the Payload Local API and has no `/admin` and no
  `/api` routes. A test fails if either appears under `apps/web/src/app`.
- `apps/cms` (the Payload admin) binds only to the Tailscale interface. It is reached through the
  Tailscale app, using MagicDNS with `tailscale serve` for HTTPS.
- Draft preview runs as a second container from the same `web` image with `PREVIEW=1`, also
  Tailscale-only. The public instance has draft mode compiled out.
- Payload's own auth stays as a second layer.
- `cms` tells `web` to revalidate over the internal Docker network, through `/internal/revalidate`
  guarded by a shared secret. The proxy in front blocks `/internal/*` from the public internet.

## Consequences
- The public attack surface is static-like pages only, so there is no origin rate limiting to tune.
- The preview instance costs about 200 MB of RAM.
- Losing Tailscale access means losing admin access. Recovery is SSH from the host's console.
- The infra that implements this (Compose, the proxy, the preview instance) is in `infra/`; this ADR
  is the rule it meets.
