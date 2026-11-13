#!/usr/bin/env bash
# Applies and re-checks the Cloudflare and R2 settings for the project's domain (ADR-0006, 0007, 0009, 0011).
# Every setting and its reason is in infra/cloudflare.md.
#
# Usage:
#   infra/cloudflare.sh            show a plan; make no changes (default)
#   infra/cloudflare.sh --apply    apply the planned changes
#
# Needs bash, curl and jq, plus these environment variables (never commit them):
#   CLOUDFLARE_API_TOKEN    scoped token, permissions listed in infra/cloudflare.md
#   CLOUDFLARE_ZONE_ID      zone id of the project's domain
#   CLOUDFLARE_ACCOUNT_ID   account id (R2 and Web Analytics live at account level)
# Names come from infra/project.env (DOMAIN, CDN_HOST and the R2 bucket names derived from
# PROJECT_NAME). Optional overrides: MAIN_DOMAIN, CDN_HOST, R2_MEDIA_BUCKET, R2_DB_BACKUP_BUCKET,
# R2_MEDIA_BACKUP_BUCKET, CLOUDFLARE_API_BASE (tests point it at a mock).
#
# The script only reads in plan mode, and a second --apply right after the first plans nothing.

set -euo pipefail

# shellcheck disable=SC1091
. "$(dirname "${BASH_SOURCE[0]}")/project.sh"
MAIN_DOMAIN="${MAIN_DOMAIN:-$DOMAIN}"
# CDN_HOST and the R2_*_BUCKET names are exported by project.sh.
API_BASE="${CLOUDFLARE_API_BASE:-https://api.cloudflare.com/client/v4}"

APPLY=0
CHANGES=0
BODY_FILE=""

die() {
  echo "error: $*" >&2
  exit 1
}

cleanup() {
  [ -n "$BODY_FILE" ] && rm -f "$BODY_FILE"
  return 0
}
trap cleanup EXIT

for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --plan) APPLY=0 ;;
    -h | --help)
      sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "unknown argument: $arg (use --apply or nothing)" ;;
  esac
done

# Against the real API the project must be filled in; the tests point CLOUDFLARE_API_BASE at a mock.
[ -n "${CLOUDFLARE_API_BASE:-}" ] || require_configured || exit 1

for var in CLOUDFLARE_API_TOKEN CLOUDFLARE_ZONE_ID CLOUDFLARE_ACCOUNT_ID; do
  [ -n "${!var:-}" ] || die "$var is not set"
done
command -v curl >/dev/null || die "curl is required"
command -v jq >/dev/null || die "jq is required"

BODY_FILE="$(mktemp "${TMPDIR:-/tmp}/cloudflare.XXXXXX")"
ZONE="/zones/$CLOUDFLARE_ZONE_ID"
ACCOUNT="/accounts/$CLOUDFLARE_ACCOUNT_ID"

# api METHOD PATH [JSON_BODY]
# Prints the response JSON. Exits on any non-2xx, except a 404 on GET, which prints "null",
# and a 403 on GET when ALLOW_403 is set, which also prints "null".
api() {
  local method="$1" path="$2" body="${3:-}" status
  local args=(-sS -o "$BODY_FILE" -w '%{http_code}' -X "$method"
    -H 'Content-Type: application/json' --config -)
  [ -n "$body" ] && args+=(--data "$body")
  # The token goes in on stdin so it stays out of argv; newer curl rejects a process-substitution file.
  status="$(printf 'header = "Authorization: Bearer %s"\n' "$CLOUDFLARE_API_TOKEN" | curl "${args[@]}" "$API_BASE$path")" || die "request failed: $method $path"
  if [ "$method" = GET ] && [ "$status" = 404 ]; then
    echo null
    return 0
  fi
  if [ "$method" = GET ] && [ "$status" = 403 ] && [ -n "${ALLOW_403:-}" ]; then
    echo null
    return 0
  fi
  case "$status" in
    2??) cat "$BODY_FILE" ;;
    *) die "$method $path returned HTTP $status: $(jq -c '.errors // .' "$BODY_FILE" 2>/dev/null || cat "$BODY_FILE")" ;;
  esac
}

# change DESCRIPTION METHOD PATH JSON_BODY
# Records a pending change; sends it only with --apply.
change() {
  local desc="$1" method="$2" path="$3" body="$4"
  CHANGES=$((CHANGES + 1))
  if [ "$APPLY" = 1 ]; then
    api "$method" "$path" "$body" >/dev/null
    echo "APPLIED  $desc"
  else
    echo "PLAN     $desc"
  fi
}

ok() {
  echo "ok       $1"
}

# --- Zone settings (ADR-0006) -------------------------------------------------------------

ensure_zone_setting() {
  local id="$1" want="$2" have
  have="$(api GET "$ZONE/settings/$id" | jq -r '.result.value')"
  if [ "$have" = "$want" ]; then
    ok "zone setting $id = $want"
  else
    change "zone setting $id: $have -> $want" PATCH "$ZONE/settings/$id" \
      "$(jq -nc --arg v "$want" '{value: $v}')"
  fi
}

ensure_bot_fight_mode_off() {
  local have
  have="$(api GET "$ZONE/bot_management" | jq -r '.result.fight_mode')"
  if [ "$have" = false ]; then
    ok "Bot Fight Mode off"
  else
    change "Bot Fight Mode: on -> off" PUT "$ZONE/bot_management" '{"fight_mode":false}'
  fi
}

# Web Analytics auto-injection off for every site; the script tag is added in code (ADR-0011).
ensure_analytics_auto_install_off() {
  local list sites tag host
  # Some tokens get a 403 here whatever Account permissions they hold. That must not stop the
  # rest of the plan: warn, and the owner turns it off in the dashboard (infra/cloudflare.md).
  list="$(ALLOW_403=1 api GET "$ACCOUNT/rum/site_info/list")"
  if [ "$list" = null ]; then
    echo "WARN     Web Analytics auto-injection: the token can't read the site list (HTTP 403); check it is off in the dashboard (Web Analytics > your site > Manage site)"
    return 0
  fi
  sites="$(jq -c '.result // [] | .[] | select(.auto_install == true)' <<<"$list")"
  if [ -z "$sites" ]; then
    ok "Web Analytics auto-injection off"
    return 0
  fi
  while IFS= read -r site; do
    tag="$(jq -r '.site_tag' <<<"$site")"
    host="$(jq -r '.host' <<<"$site")"
    change "Web Analytics auto-injection for $host: on -> off" PUT "$ACCOUNT/rum/site_info/$tag" \
      "$(jq -nc --arg h "$host" '{host: $h, auto_install: false}')"
  done <<<"$sites"
}

# --- Cache rules (ADR-0006) ---------------------------------------------------------------
# This script owns the whole http_request_cache_settings phase: rules made by hand in the
# dashboard are replaced.

ensure_cache_rules() {
  local desired current
  desired="$(jq -nc --arg cdn "$CDN_HOST" --arg main "$MAIN_DOMAIN" '[
    {
      description: "CDN host: cache, respect the origin immutable headers",
      expression: "(http.host eq \"\($cdn)\")",
      action: "set_cache_settings",
      action_parameters: {
        cache: true,
        edge_ttl: {mode: "respect_origin"},
        browser_ttl: {mode: "respect_origin"}
      },
      enabled: true
    },
    {
      description: "Main domain: never cache HTML or RSC at the edge",
      expression: "(http.host in {\"\($main)\" \"www.\($main)\"})",
      action: "set_cache_settings",
      action_parameters: {cache: false},
      enabled: true
    }
  ]')"
  # Compare only the fields we own: the API adds id, version, ref and last_updated.
  current="$(api GET "$ZONE/rulesets/phases/http_request_cache_settings/entrypoint" |
    jq -c '[(.result.rules // [])[] | {description, expression, action, action_parameters, enabled: (.enabled // true)}]')"
  if [ "$(jq -Sc . <<<"$desired")" = "$(jq -Sc . <<<"$current")" ]; then
    ok "cache rules (CDN host cached, main domain bypassed)"
  else
    change "cache rules: set CDN host cached and main domain bypassed" PUT \
      "$ZONE/rulesets/phases/http_request_cache_settings/entrypoint" \
      "$(jq -nc --argjson r "$desired" '{rules: $r}')"
  fi
}

# --- R2 (ADR-0007, 0009) ------------------------------------------------------------------

EXISTING_BUCKETS=""

ensure_bucket() {
  local name="$1"
  if grep -qxF "$name" <<<"$EXISTING_BUCKETS"; then
    ok "R2 bucket $name"
  else
    change "R2 bucket $name: create (private)" POST "$ACCOUNT/r2/buckets" \
      "$(jq -nc --arg n "$name" '{name: $n}')"
  fi
}

bucket_exists() {
  grep -qxF "$1" <<<"$EXISTING_BUCKETS"
}

ensure_media_custom_domain() {
  local b="$R2_MEDIA_BUCKET" have=""
  if bucket_exists "$b"; then
    have="$(api GET "$ACCOUNT/r2/buckets/$b/domains/custom" | jq -r '.result.domains[]?.domain')"
  fi
  if grep -qxF "$CDN_HOST" <<<"$have"; then
    ok "R2 $b public through $CDN_HOST"
  else
    # A leftover record from the old site makes the attach fail with 409 "Domain already in use".
    local stale
    stale="$(api GET "$ZONE/dns_records?name=$CDN_HOST" | jq -r '.result[]? | "\(.type) \(.content)"' | head -n1)"
    if [ -n "$stale" ]; then
      echo "WARN     DNS record $CDN_HOST already exists ($stale): the attach below fails with 'Domain already in use'. Delete it first (dashboard > DNS > Records), then re-run."
    fi
    change "R2 $b: attach custom domain $CDN_HOST" POST "$ACCOUNT/r2/buckets/$b/domains/custom" \
      "$(jq -nc --arg d "$CDN_HOST" --arg z "$CLOUDFLARE_ZONE_ID" '{domain: $d, zoneId: $z, enabled: true, minTLS: "1.2"}')"
  fi
}

# Fonts and other assets (a CSS mask image, say) load cross-origin from the CDN host.
ensure_media_cors() {
  local b="$R2_MEDIA_BUCKET" desired current="[]"
  desired="$(jq -nc --arg main "$MAIN_DOMAIN" '[{
    allowed: {
      origins: ["https://\($main)", "https://www.\($main)"],
      methods: ["GET", "HEAD"],
      headers: ["*"]
    },
    maxAgeSeconds: 86400
  }]')"
  if bucket_exists "$b"; then
    current="$(api GET "$ACCOUNT/r2/buckets/$b/cors" | jq -c '.result.rules // []')"
  fi
  if [ "$(jq -Sc . <<<"$desired")" = "$(jq -Sc . <<<"$current")" ]; then
    ok "R2 $b CORS for $MAIN_DOMAIN"
  else
    change "R2 $b: set CORS for https://$MAIN_DOMAIN" PUT "$ACCOUNT/r2/buckets/$b/cors" \
      "$(jq -nc --argjson r "$desired" '{rules: $r}')"
  fi
}

# Soft delete (ADR-0009): cms moves a deleted photo to "$TRASH_PREFIX<key>"; this rule expires
# those objects 30 days later (the copy resets the object's age, so it counts from the move).
# R2 lifecycle rules match by key prefix only, not tags, hence a prefix. Keep TRASH_PREFIX in sync
# with the trash prefix of the media collection's delete hook (it arrives with the first project
# that has uploads, ADR-0009). This script owns the bucket's whole
# lifecycle rule list (PUT replaces it). The backup bucket never gets a delete rule.
TRASH_PREFIX="${TRASH_PREFIX:-trash/}"
TRASH_MAX_AGE_SECONDS=2592000

ensure_media_lifecycle() {
  local b="$R2_MEDIA_BUCKET" desired current="[]"
  local project='map({id, enabled, conditions, deleteObjectsTransition})'
  desired="$(jq -nc --arg p "$TRASH_PREFIX" --argjson age "$TRASH_MAX_AGE_SECONDS" '[{
    id: "expire-trash-after-30-days",
    enabled: true,
    conditions: {prefix: $p},
    deleteObjectsTransition: {condition: {type: "Age", maxAge: $age}}
  }]')"
  if bucket_exists "$b"; then
    current="$(api GET "$ACCOUNT/r2/buckets/$b/lifecycle" | jq -c ".result.rules // [] | $project")"
  fi
  if [ "$(jq -Sc . <<<"$desired")" = "$(jq -Sc . <<<"$current")" ]; then
    ok "R2 $b lifecycle: delete $TRASH_PREFIX after 30 days"
  else
    change "R2 $b: lifecycle rule, delete objects under $TRASH_PREFIX 30 days after they are moved" \
      PUT "$ACCOUNT/r2/buckets/$b/lifecycle" "$(jq -nc --argjson r "$desired" '{rules: $r}')"
  fi
}

# R2 has no API token scope that writes but cannot delete (Object Read & Write includes delete).
# So the backup bucket gets an indefinite bucket lock instead: nothing in it can be deleted or
# overwritten by anyone, whatever the credentials. Not verified against the real API (see the
# end of infra/cloudflare.md).
ensure_backup_lock() {
  local b="$R2_MEDIA_BACKUP_BUCKET" desired current="[]"
  desired='[{"id":"never-delete","enabled":true,"prefix":"","condition":{"type":"Indefinite"}}]'
  if bucket_exists "$b"; then
    current="$(api GET "$ACCOUNT/r2/buckets/$b/lock" | jq -c '.result.rules // [] | map({id, enabled, prefix, condition})')"
  fi
  if [ "$(jq -Sc . <<<"$desired")" = "$(jq -Sc . <<<"$current")" ]; then
    ok "R2 $b locked (nothing can be deleted)"
  else
    change "R2 $b: bucket lock, indefinite (nothing can be deleted or overwritten)" \
      PUT "$ACCOUNT/r2/buckets/$b/lock" "$(jq -nc --argjson r "$desired" '{rules: $r}')"
  fi
}

# --- Run ----------------------------------------------------------------------------------

if [ "$APPLY" = 1 ]; then
  echo "Applying Cloudflare settings for $MAIN_DOMAIN"
else
  echo "Plan for $MAIN_DOMAIN (no changes are made; pass --apply to apply)"
fi

ensure_zone_setting ssl strict
ensure_zone_setting rocket_loader off
ensure_zone_setting email_obfuscation off
ensure_zone_setting always_online off
ensure_bot_fight_mode_off
ensure_analytics_auto_install_off
ensure_cache_rules

EXISTING_BUCKETS="$(api GET "$ACCOUNT/r2/buckets" | jq -r '.result.buckets[]?.name')"
ensure_bucket "$R2_MEDIA_BUCKET"
ensure_bucket "$R2_DB_BACKUP_BUCKET"
ensure_bucket "$R2_MEDIA_BACKUP_BUCKET"
# Buckets are created private; only the media bucket is exposed, through the CDN host.
ensure_media_custom_domain
ensure_media_cors
ensure_media_lifecycle
ensure_backup_lock

if [ "$APPLY" = 1 ]; then
  echo "$CHANGES change(s) applied"
else
  echo "$CHANGES change(s) planned"
  [ "$CHANGES" -eq 0 ] || echo "Run with --apply to make them."
fi
