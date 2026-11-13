#!/usr/bin/env bash
# Backup drill: write content through cms, let Litestream replicate it to a local
# S3 stand-in (adobe/s3mock, see infra/compose.local.yaml), restore into an empty directory and
# check the restored database has the same content. Then edit again while replication runs and
# check the next restore has the edit. Never touches R2. Needs Docker, the :local images
# (infra/README.md, "Compose"), curl and sqlite3 on the host.
#
#   infra/litestream/drill.sh [--keep]
set -euo pipefail

cd "$(dirname "$0")/../.."
# The Compose file takes its names from infra/project.env.
# shellcheck disable=SC1091
. infra/project.sh
KEEP=0
[[ "${1:-}" == "--keep" ]] && KEEP=1

for tool in docker curl sqlite3; do
  command -v "$tool" >/dev/null || { echo "drill: $tool is required" >&2; exit 2; }
done

PROJECT="drill-$$"
WORK="$(mktemp -d)"
DC=(docker compose -f infra/compose.yaml -f infra/compose.local.yaml
  -f infra/litestream/compose.drill.yaml -p "$PROJECT")

cleanup() {
  if [[ "$KEEP" == 1 ]]; then
    echo "drill: kept project $PROJECT and $WORK"
  else
    "${DC[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
    rm -rf "$WORK"
  fi
}
trap cleanup EXIT

fail() { echo "drill: FAIL: $*" >&2; exit 1; }
step() { echo "drill: $*"; }

step "starting cms, litestream and the S3 stand-in"
"${DC[@]}" up -d --wait cms litestream s3mock >/dev/null 2>&1
CMS="http://$("${DC[@]}" port cms 3001)"

EMAIL="drill@example.com"
PASSWORD="drill-password-$$"
login=$(curl -fsS -X POST "$CMS/api/users/first-register" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
TOKEN=$(printf '%s' "$login" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[[ -n "$TOKEN" ]] || fail "could not register the first user: $login"

save_site() { # $1 = tagline
  curl -fsS -X POST "$CMS/api/globals/site" -H 'content-type: application/json' \
    -H "Authorization: JWT $TOKEN" \
    -d "{\"name\":\"Drill Site\",\"tagline\":\"$1\"}" >/dev/null
}

replicate() { # block until everything written so far is in the bucket (the deploy hook)
  infra/litestream/snapshot.sh "${DC[@]:2}" >/dev/null
}

restore_into() { # $1 = empty dir (the runbook's script)
  infra/litestream/restore.sh "${DC[@]:2}" -- "$1" >/dev/null 2>&1 || true
  [[ -s "$1/site.db" ]] || fail "restore produced no database in $1"
}

q() { sqlite3 "$1" "$2"; }

check() { # $1 = restored file, $2 = expected tagline
  [[ "$(q "$1" 'PRAGMA integrity_check')" == "ok" ]] || fail "integrity_check failed on $1"
  [[ "$(q "$1" 'PRAGMA journal_mode')" == "wal" ]] || fail "restored DB is not in WAL mode"
  [[ "$(q "$1" "SELECT tagline FROM site LIMIT 1")" == "$2" ]] || fail "tagline differs in $1"
  [[ "$(q "$1" "SELECT email FROM users")" == "$EMAIL" ]] || fail "user missing in $1"
  [[ "$(q "$1" "SELECT name FROM site LIMIT 1")" == "Drill Site" ]] || fail "site name differs in $1"
}

all_healthy() {
  local n
  n=$("${DC[@]}" ps --format '{{.Service}} {{.Health}}' | grep -cE '^(cms|litestream|s3mock) healthy$' || true)
  [[ "$n" == 3 ]]
}

step "write 1 through cms, replicate, restore into an empty directory"
save_site "drill one"
replicate
restore_into "$WORK/restore1"
check "$WORK/restore1/site.db" "drill one"

step "edit while Litestream is running, then restore again"
save_site "drill two"
all_healthy || fail "a service is unhealthy while replicating"
replicate
restore_into "$WORK/restore2"
check "$WORK/restore2/site.db" "drill two"

step "the first restore still shows the old content (restores are independent)"
check "$WORK/restore1/site.db" "drill one"

step "stack still healthy"
all_healthy || fail "cms, litestream or the stand-in not healthy at the end"

echo "drill: OK"
