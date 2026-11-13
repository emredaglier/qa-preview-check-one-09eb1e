#!/usr/bin/env bash
# Release assets on the CDN. Run from CI or a laptop, never needs the server.
#
#   infra/assets.sh upload <web-image> <release>   extract /_next/static from the image, upload it
#   infra/assets.sh prune --keep <live>[,<previous live>] [--dry-run] [--max-age-days N]
#                                                  delete old releases except the kept ones; the
#                                                  kept list comes from `deploy.sh live-releases`
#   infra/assets.sh asset-prefix <release>         print the URL prefix the release's static files are served from
#   infra/assets.sh build-args <release>           print the docker build args for the release
#
# Upload runs BEFORE the new containers start (the deploy script calls it), so the
# files are on the CDN before any HTML references them. It never deletes. Prune is separate.
# Env: S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (the R2 media bucket and its
# write key; CI and deploy.sh set them, infra/release-assets.ts documents them. They are not in
# apps/cms/.env.example because cms has no media collection yet), CDN_ORIGIN (build-args and
# asset-prefix, from infra/project.env), STATIC_DIR_IN_IMAGE (default /app/apps/web/.next/static).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$here/project.sh"
cli=(node "$here/release-assets.ts")
static_in_image="${STATIC_DIR_IN_IMAGE:-/app/apps/web/.next/static}"

die() { echo "assets.sh: $*" >&2; exit 1; }
# Where a release's static files are served from: the one formula (build args and smoke use it).
asset_prefix() { echo "$CDN_ORIGIN/releases/$1"; }

case "${1:-}" in
  upload)
    image="${2:-}" release="${3:-}"
    [ -n "$image" ] && [ -n "$release" ] || die "usage: assets.sh upload <web-image> <release>"
    tmp="$(mktemp -d "${TMPDIR:-/tmp}/assets.XXXXXX")"
    ctr=""
    cleanup() { [ -z "$ctr" ] || docker rm -f "$ctr" >/dev/null 2>&1 || true; rm -rf "$tmp"; }
    trap cleanup EXIT
    ctr="$(docker create "$image")"
    docker cp "$ctr:$static_in_image/." "$tmp/static"
    "${cli[@]}" upload --dir "$tmp/static" --release "$release"
    ;;
  prune)
    shift
    exec "${cli[@]}" prune "$@"
    ;;
  asset-prefix)
    release="${2:-}"
    [ -n "$release" ] || die "usage: assets.sh asset-prefix <release>"
    asset_prefix "$release"
    ;;
  build-args)
    release="${2:-}"
    [ -n "$release" ] || die "usage: assets.sh build-args <release>"
    echo "--build-arg ASSET_PREFIX=$(asset_prefix "$release") --build-arg DEPLOYMENT_ID=$release"
    ;;
  *)
    die "usage: assets.sh upload <web-image> <release> | prune [...] | asset-prefix <release> | build-args <release>"
    ;;
esac
