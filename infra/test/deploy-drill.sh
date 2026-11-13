#!/usr/bin/env bash
# Deploy drill against a real local stack. Needs Docker and the three images built
# (infra/README.md, "Images"); it never pulls or pushes. Run from anywhere:
#
#   infra/test/deploy-drill.sh            # uses <project>/{web,cms,migrate}:local
#   BASE_TAG=abc infra/test/deploy-drill.sh
#
# Its own Compose project (<project>-drill), data volume and ports (127.0.0.1:18080 site, 13001 cms,
# 13002 preview), so it can run next to a normal local stack. Removes everything at the end.
#
# Proves: a good tag deploys; a build with missing static files and one that never gets healthy
# both roll back by themselves and call a stub webhook; a failing migration leaves the running
# containers untouched; pre-migration copies are kept to KEEP_SNAPSHOTS; the manual rollback works.
set -euo pipefail

infra="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
. "$infra/project.sh"
base_prefix="${BASE_PREFIX:-$PROJECT_NAME}"
base_tag="${BASE_TAG:-local}"
drill="$PROJECT_NAME-drill"
site_port="${DRILL_SITE_PORT:-18080}"
hook_port="${DRILL_HOOK_PORT:-18099}"
work="$(mktemp -d)"

export COMPOSE_PROJECT_NAME="$drill"
export COMPOSE_FILE="$infra/compose.yaml:$infra/compose.local.yaml:$work/drill.yaml"
export IMAGE_PREFIX="$drill"
export STATE_DIR="$work/state" ENV_DIR="$work/env"
export DEPLOY_PULL=0 KEEP_SNAPSHOTS=3 WAIT_TIMEOUT=90
export SMOKE_URL="http://127.0.0.1:$site_port" SMOKE_RESOLVE='' SMOKE_INSECURE=0
export ALERT_WEBHOOK_URL="http://127.0.0.1:$hook_port/hook"

hook_pid=""
cleanup() {
  [[ -n "$hook_pid" ]] && kill "$hook_pid" 2>/dev/null || true
  docker compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

step() { printf '\n=== %s\n' "$*"; }
pass() { printf 'PASS %s\n' "$*"; }
die() {
  printf 'DRILL FAILED: %s\n' "$*" >&2
  exit 1
}
deploy() { "$infra/deploy.sh" "$@"; }
web_image() { docker inspect --format '{{.Config.Image}}' "$(docker compose ps -q web)"; }
web_started() { docker inspect --format '{{.Id}} {{.State.StartedAt}}' "$(docker compose ps -q web)"; }
hooks() { cat "$work/hooks" 2>/dev/null | wc -l | tr -d ' '; }

mkdir -p "$work/env"
cat >"$work/drill.yaml" <<YAML
services:
  caddy:
    ports: !override ['127.0.0.1:$site_port:80']
  cms:
    ports: !override ['127.0.0.1:${DRILL_CMS_PORT:-13001}:3001']
  web-preview:
    ports: !override ['127.0.0.1:${DRILL_PREVIEW_PORT:-13002}:3000']
YAML

step "images"
for svc in web cms migrate; do
  for tag in good1 good2 nostatic crash badmig; do
    docker tag "$base_prefix/$svc:$base_tag" "$drill/$svc:$tag"
  done
done
# Healthy container, but the chunks are gone: the old in-place-build failure.
printf 'FROM %s\nUSER root\nRUN rm -rf /app/apps/web/.next/static\nUSER app\n' \
  "$base_prefix/web:$base_tag" | docker build -q -t "$drill/web:nostatic" - >/dev/null
# Never becomes healthy.
printf 'FROM %s\nCMD ["node", "-e", "console.error(\\"boot failure\\"); process.exit(1)"]\n' \
  "$base_prefix/web:$base_tag" | docker build -q -t "$drill/web:crash" - >/dev/null
# Migration fails.
printf 'FROM %s\nCMD ["node", "-e", "console.error(\\"migration boom\\"); process.exit(1)"]\n' \
  "$base_prefix/migrate:$base_tag" | docker build -q -t "$drill/migrate:badmig" - >/dev/null
pass "drill images tagged and built"

step "stub webhook on :$hook_port"
node -e '
  const fs = require("node:fs")
  require("node:http").createServer((q, s) => {
    let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => {
      fs.appendFileSync(process.argv[1], b.replace(/\n/g, " ") + "\n"); s.writeHead(204).end()
    })
  }).listen(Number(process.argv[2]), "127.0.0.1")
' "$work/hooks" "$hook_port" &
hook_pid=$!
sleep 1

step "0. migrate and seed the empty volume (home needs the Site global)"
RELEASE=good1 docker compose run --rm --no-deps -T migrate >/dev/null
RELEASE=good1 docker compose run --rm --no-deps -T migrate node node_modules/payload/bin.js run seed.ts
pass "seeded"

step "1. first deploy of a good tag"
deploy deploy good1 || die "good1 did not deploy"
[[ "$(web_image)" == "$drill/web:good1" ]] || die "web is $(web_image)"
pass "good1 is live"

step "2. deploy a second good tag"
deploy deploy good2 || die "good2 did not deploy"
[[ "$(web_image)" == "$drill/web:good2" ]] || die "web is $(web_image)"
[[ "$(hooks)" == 0 ]] || die "a good deploy alerted"
pass "good2 is live, no alert"

step "3. a release with missing static files rolls back by itself"
if deploy deploy nostatic; then die "nostatic deployed"; fi
[[ "$(web_image)" == "$drill/web:good2" ]] || die "web is $(web_image) after the rollback"
[[ "$(hooks)" == 1 ]] || die "expected 1 webhook call, got $(hooks)"
"$infra/smoke.sh" "$SMOKE_URL" >/dev/null || die "site fails smoke after the rollback"
pass "rolled back to good2, webhook called, site passes"

step "4. a release that never gets healthy rolls back by itself"
if deploy deploy crash; then die "crash deployed"; fi
[[ "$(web_image)" == "$drill/web:good2" ]] || die "web is $(web_image) after the rollback"
[[ "$(hooks)" == 2 ]] || die "expected 2 webhook calls, got $(hooks)"
pass "rolled back to good2, webhook called"

step "5. a failing migration leaves the old containers running untouched"
before="$(web_started)"
if deploy deploy badmig; then die "badmig deployed"; fi
[[ "$(web_started)" == "$before" ]] || die "web container changed: $before -> $(web_started)"
[[ "$(web_image)" == "$drill/web:good2" ]] || die "web is $(web_image)"
[[ "$(hooks)" == 3 ]] || die "expected 3 webhook calls, got $(hooks)"
pass "same web container (id and start time), webhook called"

step "6. pre-migration copies: newest $KEEP_SNAPSHOTS kept"
copies="$(RELEASE=good2 docker compose run --rm --no-deps -T --entrypoint ls migrate /data/pre-migrate)"
printf '%s\n' "$copies"
[[ "$(wc -l <<<"$copies" | tr -d ' ')" == "$KEEP_SNAPSHOTS" ]] || die "expected $KEEP_SNAPSHOTS copies"
grep -q -- '-good2-to-badmig.db$' <<<"$copies" || die "newest copy missing"
pass "$KEEP_SNAPSHOTS copies, newest is good2-to-badmig"

step "7. manual rollback"
deploy rollback || die "manual rollback failed"
[[ "$(web_image)" == "$drill/web:good1" ]] || die "web is $(web_image)"
[[ "$(deploy status)" == good1 ]] || die "history is $(deploy status)"
pass "good1 is live again"

printf '\nwebhook bodies:\n'
cat "$work/hooks"
printf '\nDRILL PASSED\n'
