# Cloudflare and R2 settings

`infra/cloudflare.sh` applies and re-checks every setting below. It needs `bash`, `curl` and `jq`.

```sh
export CLOUDFLARE_API_TOKEN=...      # see "Token" below
export CLOUDFLARE_ZONE_ID=...        # dashboard: your domain > Overview > API
export CLOUDFLARE_ACCOUNT_ID=...     # same panel

infra/cloudflare.sh            # plan: reads only, prints what would change
infra/cloudflare.sh --apply    # apply the planned changes
```

Run the plan first. Run it again after `--apply`: it should print `0 change(s) planned`. Re-run the plan any time to find drift (a setting someone changed in the dashboard). The script only changes what differs, so it is safe to repeat. Agents never run it against the real API; the owner runs it once per project. Tests run it against a local mock (`infra/cloudflare.test.ts`).

The domain, CDN host and bucket names come from [`project.env`](project.env) (`DOMAIN`, `CDN_HOST` and the bucket names derived from `PROJECT_NAME`: `<project>-media`, `<project>-db-backups`, `<project>-backup`). The script refuses to run against the real API while `DOMAIN` is still the template's `example.com`. Optional overrides: `MAIN_DOMAIN`, `CDN_HOST`, `R2_MEDIA_BUCKET`, `R2_DB_BACKUP_BUCKET`, `R2_MEDIA_BACKUP_BUCKET`.

## Zone settings

| Setting                      | Value         | Why                                                                                                           | ADR                                                                 |
| ---------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| SSL/TLS mode                 | Full (strict) | The origin has a valid certificate (Caddy); strict stops a downgrade to unverified TLS.                       | [0004](../docs/adr/0004-docker-compose-caddy-hardened-bootstrap.md) |
| Bot Fight Mode               | off           | It can challenge subresource requests, and the free plan can't exempt paths. Always-on DDoS protection stays. | [0006](../docs/adr/0006-edge-caches-immutable-only.md)              |
| Rocket Loader                | off           | Rewrites script tags; breaks the GSAP/Lenis load order.                                                       | [0006](../docs/adr/0006-edge-caches-immutable-only.md)              |
| Email Obfuscation            | off           | Injects a script and rewrites the HTML.                                                                       | [0006](../docs/adr/0006-edge-caches-immutable-only.md)              |
| Always Online                | off           | Serves stale HTML copies, which can point at deleted chunks.                                                  | [0006](../docs/adr/0006-edge-caches-immutable-only.md)              |
| Web Analytics auto-injection | off           | Analytics loads from an explicit script tag in code, so it is visible and testable.                           | [0011](../docs/adr/0011-observability-free-tier.md)                 |

## Cache rules

The script owns the whole cache-rules phase (`http_request_cache_settings`). Rules added by hand there are replaced on `--apply`.

1. **CDN host** (`http.host eq "<CDN_HOST>"`): cache, edge and browser TTL respect the origin. R2 objects and `/_next/static` releases have unique keys and immutable headers, so they can be cached forever without purges. ([0006](../docs/adr/0006-edge-caches-immutable-only.md), [0007](../docs/adr/0007-static-assets-and-images-on-r2.md))
2. **Main domain** (`<DOMAIN>`, `www.<DOMAIN>`): bypass cache. HTML and RSC are never cached at the edge, so publishing needs no purge and no page can point at a deleted chunk. Bypass is explicit rather than relying on Cloudflare's default of not caching HTML. ([0006](../docs/adr/0006-edge-caches-immutable-only.md))

## R2

| Bucket                 | Access                  | Purpose                                               | ADR                                                        |
| ---------------------- | ----------------------- | ----------------------------------------------------- | ---------------------------------------------------------- |
| `<project>-media`      | public via the CDN host | Media, plus `/_next/static` per release               | [0007](../docs/adr/0007-static-assets-and-images-on-r2.md) |
| `<project>-db-backups` | private                 | Litestream database backups                           | [0003](../docs/adr/0003-sqlite-wal-litestream.md)          |
| `<project>-backup`     | private                 | Nightly copy of new media; the copy job never deletes | [0009](../docs/adr/0009-media-soft-delete-and-backup.md)   |

- **Custom domain:** The CDN host (`cdn.<DOMAIN>` by default) is attached to the media bucket only (TLS 1.2 minimum). The zone must be on the same Cloudflare account. No other bucket gets a public domain or an `r2.dev` URL.
- **CORS on the media bucket:** `GET` and `HEAD` from `https://<DOMAIN>` and `https://www.<DOMAIN>`. Fonts and other assets (a CSS mask image, say) load cross-origin from the CDN host and fail without it.
- **Lifecycle:** a rule on the media bucket that deletes objects under `trash/` 30 days after they are moved there ([0009](../docs/adr/0009-media-soft-delete-and-backup.md)). R2 lifecycle rules match by key prefix only, not tags, so soft delete is a move to `trash/<key>` (done by `cms` once the project has a media collection, ADR-0009). The script owns the bucket's whole rule list. The `_next/static` 30-day release retention ([0007](../docs/adr/0007-static-assets-and-images-on-r2.md)) belongs to the CI upload, not this script.
- **Backup bucket lock:** `<project>-backup` gets an indefinite bucket lock, because R2 tokens cannot write without also being able to delete. With the lock, nothing in it can be deleted or overwritten with an object key, whatever its permissions. Only someone allowed to edit the bucket's configuration can remove the rule; the owner does that for a removal request ([README](README.md), "Remove a file on request"), and this script puts the rule back. The bucket never gets a lifecycle rule.

## Token

Create one API token only for this script, scoped to the project's zone and the account, with the least permissions that work. Names are as in the dashboard's token builder; check them there, as Cloudflare renames them from time to time.

| Scope   | Permission               | Used for                                             |
| ------- | ------------------------ | ---------------------------------------------------- |
| Zone    | Zone Settings: Edit      | SSL, Rocket Loader, Email Obfuscation, Always Online |
| Zone    | Zone: Read               | Zone lookups for the custom domain                   |
| Zone    | Bot Management: Edit     | Bot Fight Mode                                       |
| Zone    | Cache Rules: Edit        | Cache rules phase                                    |
| Zone    | DNS: Edit                | R2 creates the CDN host DNS record                   |
| Account | Workers R2 Storage: Edit | Buckets, custom domain, CORS, lifecycle              |

Web Analytics auto-injection is the one setting the token can't manage: in practice no API-token permission unlocks the Web Analytics site list (`/rum/site_info/list` answers 403 "Authentication error", even with Account Settings: Edit; seen on the first project). The plan prints a `WARN` line for it and carries on. Turn it off by hand: dashboard, Analytics & Logs, Web Analytics, your site, Manage site, automatic setup off.

Limit the token to the project's zone and this account, set an expiry, keep it in your password manager, and revoke it after the first apply if you won't re-check often. This token is separate from the R2 access keys the apps use at runtime.

## Verifying the API calls

The script was written against the Cloudflare API reference and tested only against a mock, never the real API. If the first real plan fails on an endpoint, the error shows the HTTP status and Cloudflare's message; the calls live in `ensure_*` functions near the top of `infra/cloudflare.sh`.

## CDN host on the media bucket

Attaching the CDN host to the media bucket fails with HTTP 409 "Domain already in use" while an older `cdn` DNS record (for example a proxied CNAME to `public.r2.dev`) exists. The plan prints a `WARN` for it: delete the record in DNS, then `--apply`. After the attach, Cloudflare recreates the CNAME itself and the domain shows `ownership: pending` for a few minutes; until it turns active the CDN answers 403 (error 1014). Wait, then re-test.
