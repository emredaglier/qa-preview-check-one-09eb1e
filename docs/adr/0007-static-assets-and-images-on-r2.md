# 7. Static assets and images served from R2; no runtime image optimizer

Date: 2026-11-09 · Status: accepted

## Context
Deploys break open tabs (version skew). Images that are not edge-cached, or whose originals appear
in `srcset`, cost bandwidth and time.

## Decision
- CI uploads each release's `/_next/static` to R2, served from a CDN host through `assetPrefix`.
  Releases are kept for 30 days. `deploymentId` is set, so a stale tab does a clean full reload.
- `srcset` is built from Payload's pre-generated WebP sizes on R2. Originals are never included,
  and `/_next/image` is not used.
- Object keys are unique per upload, so the CDN caches them as immutable.

## Consequences
The VPS does no image work while serving visitors; resizing happens in `cms` at upload time. The
starter's web config reads `ASSET_PREFIX` and `DEPLOYMENT_ID`, and `infra/` holds the upload scripts.
The media collection arrives with the first project that needs images.
