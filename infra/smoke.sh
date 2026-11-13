#!/usr/bin/env bash
# Post-deploy smoke checks (ADR-0005). Exits non-zero if any check fails.
#
#   infra/smoke.sh <base-url>        e.g. infra/smoke.sh http://127.0.0.1:8080
#
# Checks, in order:
#   1. home answers 200 (retried for SMOKE_HOME_WAIT seconds: Caddy may still see web as down)
#   2. one static chunk, parsed from the home HTML, answers 200 with a JavaScript type
#   3. one content page, the first page of /sitemap.xml that is not home, answers 200
#   4. one media image, the first <img> on that page (or on home), answers 200 with an image type
# 3 and 4 are skipped with a NOTICE when the site has no such page or image.
#
# Env (all optional):
#   SMOKE_RESOLVE    curl --resolve value for the base host, e.g. example.com:443:127.0.0.1, so the
#                    check hits this server's Caddy, not Cloudflare
#   SMOKE_INSECURE   1 = skip TLS verification for the base host (the Origin CA certificate is
#                    trusted by Cloudflare only)
#   SMOKE_HOME_WAIT  seconds to keep retrying home (default 60)
#   SMOKE_TIMEOUT    per-request timeout in seconds (default 10)
set -euo pipefail

base="${1:?usage: smoke.sh <base-url>}"
base="${base%/}"
home_wait="${SMOKE_HOME_WAIT:-60}"
timeout="${SMOKE_TIMEOUT:-10}"

tmp="$(mktemp -d "${TMPDIR:-/tmp}/smoke.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

log() { printf 'smoke: %s\n' "$*"; }
fail() {
  printf 'smoke: FAIL %s\n' "$*" >&2
  exit 1
}

# fetch <url> <outfile>: prints "<status> <content-type>". Base-host options apply only to the
# base host, so CDN requests are verified normally.
fetch() {
  local url="$1" out="$2" opts=()
  if [[ "$url" == "$base"/* || "$url" == "$base" ]]; then
    [[ -n "${SMOKE_RESOLVE:-}" ]] && opts+=(--resolve "$SMOKE_RESOLVE")
    [[ "${SMOKE_INSECURE:-}" == 1 ]] && opts+=(--insecure)
  fi
  local res
  res="$(curl -sS --max-time "$timeout" ${opts[@]+"${opts[@]}"} -o "$out" \
    -w '%{http_code} %{content_type}' "$url" 2>/dev/null || true)"
  [[ "$res" =~ ^[0-9]{3} ]] || res="000 -"
  printf '%s -\n' "$res"
}

# Absolute URL for a link found in a page served from the base.
absolute() {
  local link="${1//&amp;/&}"
  case "$link" in
    http://* | https://*) printf '%s' "$link" ;;
    //*) printf '%s:%s' "${base%%:*}" "$link" ;;
    /*) printf '%s%s' "$base" "$link" ;;
    *) printf '%s/%s' "$base" "$link" ;;
  esac
}

# 1. Home.
deadline=$((SECONDS + home_wait))
while :; do
  read -r status _ < <(fetch "$base/" "$tmp/home.html")
  [[ "$status" == 200 ]] && break
  ((SECONDS >= deadline)) && fail "home $base/ answered $status"
  sleep 2
done
log "ok   home $base/"

# 2. One static chunk from the home HTML (relative, or absolute on the CDN with an asset prefix).
chunk="$(grep -oE 'src="[^"]*/_next/static/[^"]*\.js[^"]*"' "$tmp/home.html" | head -n 1 || true)"
[[ -n "$chunk" ]] || fail "chunk: home links no /_next/static/*.js script"
chunk="$(absolute "$(sed -E 's/^src="//; s/"$//' <<<"$chunk")")"
read -r status type _ < <(fetch "$chunk" "$tmp/chunk.js")
[[ "$status" == 200 ]] || fail "chunk $chunk answered $status"
[[ "$type" =~ (java|ecma)script ]] || fail "chunk $chunk has content type $type"
log "ok   chunk $chunk"

# 3. One content page: the first page that is not home in /sitemap.xml. A site with no sitemap (the
# starter has none yet) or no pages besides home skips this check, with a notice.
page=""
read -r status _ < <(fetch "$base/sitemap.xml" "$tmp/sitemap.xml")
if [[ "$status" == 200 ]]; then
  page="$(grep -oE '<loc>[^<]*</loc>' "$tmp/sitemap.xml" |
    sed -E 's#^<loc>##; s#</loc>$##; s#^https?://[^/]+##' | grep -vE '^/?$' | head -n 1 || true)"
fi
page_html="$tmp/home.html"
if [[ -z "$page" ]]; then
  log "NOTICE no content page in the sitemap: content page check skipped"
else
  page="$(absolute "$page")"
  read -r status _ < <(fetch "$page" "$tmp/page.html")
  [[ "$status" == 200 ]] || fail "page $page answered $status"
  page_html="$tmp/page.html"
  log "ok   page $page"
fi

# 4. One media image: the first <img> on that page (or on home when there is no content page).
img="$(grep -oE '<img[^>]*>' "$page_html" | grep -oE ' src="[^"]+"' | head -n 1 || true)"
if [[ -z "$img" ]]; then
  log "NOTICE no <img> on the checked page: image check skipped"
  log "smoke passed"
  exit 0
fi
img="$(absolute "$(sed -E 's/^ src="//; s/"$//' <<<"$img")")"
read -r status type _ < <(fetch "$img" "$tmp/image")
[[ "$status" == 200 ]] || fail "image $img answered $status"
[[ "$type" == image/* ]] || fail "image $img has content type $type"
log "ok   image $img"

log "smoke passed"
