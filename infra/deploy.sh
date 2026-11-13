#!/usr/bin/env bash
# Deploy a release tag with automatic rollback (ADR-0005). Runs on the server, from the
# directory that holds compose.yaml (CI runs it over the tailnet).
#
#   infra/deploy.sh deploy <tag>   lock, pull, [assets], Litestream sync + pre-migration DB copy,
#                                  migrate, swap, smoke check;
#                                  on a failed swap or smoke check: swap back, re-check, alert, exit 1
#   infra/deploy.sh rollback       swap back to the release before the current one (no migrations)
#   infra/deploy.sh status         print the release history (last line = live)
#   infra/deploy.sh live-releases  the previous live release and the live one (last line), for
#                                  `assets.sh prune --keep` (a failed, rolled-back tag is never here)
#
# Versioned config. CI ships each release's infra/ folder to <root>/releases/<tag>/ and runs that
# copy of this script (<root> = <APP_DIR>/infra, /opt/<project>/infra by default). The
# long-running services always run from
# <root>/live/, a copy of the live release's folder: a swap first copies the target release's
# folder there, so a rollback also brings back that release's compose file and Caddy/Litestream
# config. Caddy and Litestream mount their config DIRECTORIES from live/ (a single-file bind mount
# would keep the old inode), and are reloaded/recreated when that config changed. Run `rollback`
# and `status` from <root>/live/. Outside this layout (laptop, tests) it all runs from this folder.
#
# A failed pull, asset upload, sync, DB copy or migration stops BEFORE anything is swapped: the
# running containers are left untouched. Migrations are additive (ADR-0003), so a rollback never reverts the schema.
#
# Env (optional; also read from $ENV_DIR/deploy.env if that file exists):
#   ALERT_WEBHOOK_URL     POSTed on every failure. Unset = the alert is only logged, loudly.
#   ALERT_WEBHOOK_FORMAT  json (default): {"text","content"}, for Slack, Discord, Telegram
#                         (sendMessage?chat_id=...); text: plain body, for ntfy
#   SMOKE_URL             default https://<DOMAIN>, resolved to this host's Caddy:
#   SMOKE_RESOLVE         default <DOMAIN>:443:127.0.0.1 (empty = resolve normally)
#   SMOKE_INSECURE        default 1 (the Origin CA certificate is not publicly trusted)
#   STATE_DIR             default <APP_DIR>/state (release history and the deploy lock)
#   ENV_DIR               default <APP_DIR>/env
#   (DOMAIN, PROJECT_NAME and APP_DIR come from infra/project.env, next to this script.)
#   KEEP_SNAPSHOTS        pre-migration DB copies to keep, default 5
#   WAIT_TIMEOUT          seconds to wait for health after a swap, default 180
#   DEPLOY_PULL           0 = skip `docker compose pull` (local images, tests)
#   DEPLOY_ASSETS         1 = upload the release's static files before the swap and prune old
#                         releases after a healthy one (infra/assets.sh; needs Node 24,
#                         the repo's node_modules and S3_*). Default 0: CI uploads them (infra/ci.sh
#                         upload). <tag> must be the release the image was built with.
#   COMPOSE_FILE, COMPOSE_PROJECT_NAME, IMAGE_PREFIX, DATA_DIR ...: passed through to Compose.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
infra_root=""
if [[ "$(basename "$(dirname "$here")")" == releases ]]; then
  infra_root="$(dirname "$(dirname "$here")")"
elif [[ "$(basename "$here")" == live && -d "$(dirname "$here")/releases" ]]; then
  infra_root="$(dirname "$here")"
fi
releases_dir="${infra_root:+$infra_root/releases}"
live_dir="${infra_root:+$infra_root/live}"
live_dir="${live_dir:-$here}"
# shellcheck disable=SC1091
. "$here/project.sh"
if [[ -f "$ENV_DIR/deploy.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "$ENV_DIR/deploy.env"
  set +a
fi
STATE_DIR="${STATE_DIR:-$APP_DIR/state}"
SMOKE_URL="${SMOKE_URL:-https://$DOMAIN}"
export SMOKE_RESOLVE="${SMOKE_RESOLVE-$DOMAIN:443:127.0.0.1}"
export SMOKE_INSECURE="${SMOKE_INSECURE-1}"
KEEP_SNAPSHOTS="${KEEP_SNAPSHOTS:-5}"
WAIT_TIMEOUT="${WAIT_TIMEOUT:-180}"
assets_cmd="${ASSETS_CMD:-$here/assets.sh}"
history_file="$STATE_DIR/releases"
lock_dir="$STATE_DIR/deploy.lock"

log() { printf '%s deploy: %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() {
  printf 'deploy: %s\n' "$*" >&2
  exit 1
}

# One-off work (pull, migrate, DB copy) uses this release's files; the long-running services are
# always started from live/ (same Compose project name, so the same containers and volumes).
compose() { (cd "$here" && docker compose "$@"); }
live_compose() { (cd "$live_dir" && docker compose "$@"); }

# --- alert ------------------------------------------------------------------------------------

json_string() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\t'/ }"
  printf '"%s"' "$s"
}

alert() {
  local msg
  msg="$PROJECT_NAME deploy on $(hostname): $*"
  printf '\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n' >&2
  printf '!!! ALERT: %s\n' "$msg" >&2
  if [[ -z "${ALERT_WEBHOOK_URL:-}" ]]; then
    printf '!!! ALERT_WEBHOOK_URL is not set: nobody was notified. Set it in %s/deploy.env.\n' \
      "$ENV_DIR" >&2
  else
    local type body
    if [[ "${ALERT_WEBHOOK_FORMAT:-json}" == text ]]; then
      type='text/plain; charset=utf-8' body="$msg"
    else
      type='application/json' body="{\"text\":$(json_string "$msg"),\"content\":$(json_string "$msg")}"
    fi
    if ! curl -fsS --max-time 10 -X POST -H "Content-Type: $type" --data-binary "$body" \
      "$ALERT_WEBHOOK_URL" >/dev/null 2>&1; then
      printf '!!! The alert webhook call FAILED: nobody was notified.\n' >&2
    fi
  fi
  printf '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n\n' >&2
}

# --- lock -------------------------------------------------------------------------------------
# mkdir is atomic. A lock left by a killed deploy is taken over once its pid is gone.

lock() {
  mkdir -p "$STATE_DIR"
  if ! mkdir "$lock_dir" 2>/dev/null; then
    local pid
    pid="$(cat "$lock_dir/pid" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      die "another deploy is running (pid $pid, lock $lock_dir)"
    fi
    log "taking over a stale lock (pid ${pid:-unknown} is gone)"
    rm -rf "$lock_dir"
    mkdir "$lock_dir" || die "could not take the lock $lock_dir"
  fi
  echo $$ >"$lock_dir/pid"
  trap 'rm -rf "$lock_dir"' EXIT
}

# --- releases ---------------------------------------------------------------------------------

valid_tag() { valid_release_name "$1"; }

# The live release: the last recorded one, else the tag of the running web container.
current_release() {
  if [[ -s "$history_file" ]]; then
    tail -n 1 "$history_file"
    return
  fi
  local id image
  id="$(compose ps -q web 2>/dev/null | head -n 1 || true)"
  [[ -n "$id" ]] || return 0
  image="$(docker inspect --format '{{.Config.Image}}' "$id" 2>/dev/null || true)"
  [[ "$image" == *:* ]] && printf '%s\n' "${image##*:}"
  return 0
}

record_release() {
  mkdir -p "$STATE_DIR"
  { cat "$history_file" 2>/dev/null || true; printf '%s\n' "$1"; } | tail -n 20 >"$history_file.tmp"
  mv "$history_file.tmp" "$history_file"
}

# Every long-running service (not the one-off migrate), so services added later (Litestream)
# are included without editing this script.
app_services() { live_compose config --services | grep -vx migrate; }

# --- versioned config -------------------------------------------------------------------------

# Copies the tree <src> over <dst> and removes what <src> does not have. Each file is written
# to a temporary name and renamed: the running deploy.sh in live/ keeps reading its old inode.
# Returns 1 on the first failure. Callers use it on the left of `||`, where `set -e` is off, and
# `exit` in a piped loop only leaves the loop's subshell, so every pipeline is checked itself.
sync_tree() {
  local src="$1" dst="$2" f
  mkdir -p "$dst" || return 1
  (cd "$src" && find . -type d) | while IFS= read -r f; do mkdir -p "$dst/$f" || exit 1; done || return 1
  (cd "$src" && find . -type f) | while IFS= read -r f; do
    cp -p "$src/$f" "$dst/$f.deploy-tmp" || exit 1
    mv -f "$dst/$f.deploy-tmp" "$dst/$f" || exit 1
  done || return 1
  (cd "$dst" && find . -type f) | while IFS= read -r f; do
    [[ -e "$src/$f" ]] || rm -f "$dst/$f" || exit 1
  done || return 1
}

# Content checksum of config paths under live/ (empty if missing).
config_digest() { (cd "$live_dir" && find "$@" -type f 2>/dev/null | LC_ALL=C sort | xargs cksum 2>/dev/null) || true; }

# A release recorded before its folder was kept (e.g. read from the running container): keep
# what live/ runs now as its config, so a rollback to it restores that.
save_live_config() {
  [[ -n "$releases_dir" && -n "${1:-}" && -f "$live_dir/compose.yaml" ]] || return 0
  valid_tag "$1" || return 0
  [[ -e "$releases_dir/$1" ]] && return 0
  log "keeping the running config as the config of $1"
  sync_tree "$live_dir" "$releases_dir/$1"
}

# activate_config <tag>: make live/ the config of <tag>. Sets config_changed (caddy, litestream).
config_changed=""
activate_config() {
  config_changed=""
  [[ -n "$releases_dir" ]] || return 0
  local src="$releases_dir/$1" caddy litestream
  if [[ ! -f "$src/compose.yaml" ]]; then
    log "WARNING no saved config for $1 in $releases_dir: it runs with the config now in live/"
    return 0
  fi
  caddy="$(config_digest caddy)" litestream="$(config_digest litestream/litestream.yml)"
  log "config of $1 -> $live_dir"
  sync_tree "$src" "$live_dir" || return 1
  [[ "$(config_digest caddy)" == "$caddy" ]] || config_changed+=" caddy"
  [[ "$(config_digest litestream/litestream.yml)" == "$litestream" ]] || config_changed+=" litestream"
  return 0
}

# A changed mounted config is not picked up by `up` (same mount, same image): reload Caddy
# (no dropped connections; recreate it if the reload fails) and recreate Litestream.
apply_config_changes() {
  if [[ "$config_changed" == *caddy* ]]; then
    log "caddy config changed: reload"
    if ! live_compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile; then
      log "caddy reload failed: recreating caddy"
      RELEASE="$1" live_compose up -d --wait --wait-timeout "$WAIT_TIMEOUT" --no-deps \
        --force-recreate caddy || return 1
    fi
  fi
  if [[ "$config_changed" == *litestream* ]] && app_services | grep -qx litestream; then
    log "litestream config changed: recreate"
    RELEASE="$1" live_compose up -d --wait --wait-timeout "$WAIT_TIMEOUT" --no-deps \
      --force-recreate litestream || return 1
  fi
  return 0
}

# After a good deploy: drop the config folders of releases no longer in the history.
prune_configs() {
  [[ -n "$releases_dir" && -d "$releases_dir" ]] || return 0
  local d name
  for d in "$releases_dir"/*/; do
    [[ -d "$d" ]] || continue
    name="$(basename "$d")"
    grep -qxF -- "$name" "$history_file" 2>/dev/null && continue
    log "removing the config of $name (not in the release history)"
    rm -rf -- "$d"
  done
}

# swap <tag>: put <tag>'s config in place, start every service on <tag> and wait until they are
# all healthy, then apply a changed Caddy/Litestream config.
swap() {
  local services
  activate_config "$1" || return 1
  services="$(app_services | tr '\n' ' ')"
  log "swap to $1: $services"
  # shellcheck disable=SC2086 # word splitting of the service list is intended
  RELEASE="$1" live_compose up -d --wait --wait-timeout "$WAIT_TIMEOUT" --no-deps $services || return 1
  apply_config_changes "$1"
}

# `pnpm smoke` is the pre-release gate (built image, fixture data, CI only). It cannot
# run here: it needs fixtures and a Playwright install. This post-deploy check stays HTTP-only.
smoke() { "$here/smoke.sh" "$SMOKE_URL"; }

# Flush the WAL to the off-site replica and wait, so a bad migration can be undone with
# `infra/litestream/restore.sh ... -timestamp <restore point>`. Skipped (with a notice) only while
# Litestream is not running yet, i.e. the first deploy of a fresh server.
offsite_sync() {
  if [[ -z "$(compose ps -q --status running litestream 2>/dev/null || true)" ]]; then
    log "NOTICE litestream is not running: off-site sync skipped (first deploy?), local copy only"
    return 0
  fi
  log "litestream sync (infra/litestream/snapshot.sh)"
  (cd "$here" && litestream/snapshot.sh) || return 1
  local at
  at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  log "restore point for infra/litestream/restore.sh: -timestamp $at"
}

swap_and_check() { swap "$1" && smoke; }

# --- pre-migration safety copy --------------------------------------------------------------
# VACUUM INTO gives a consistent copy while cms keeps writing. Runs in the new migrate image with
# Node's built-in SQLite, so the host needs no sqlite3. Keeps the newest $KEEP_SNAPSHOTS.

# shellcheck disable=SC2016 # JavaScript, not shell: no expansion wanted
snapshot_js='
import fs from "node:fs"
import { DatabaseSync } from "node:sqlite"
const db = process.env.DATABASE_PATH
const dir = `${db.replace(/\/[^/]*$/, "")}/pre-migrate`
if (!fs.existsSync(db)) {
  console.log(`snapshot: no database at ${db} yet, nothing to copy`)
  process.exit(0)
}
fs.mkdirSync(dir, { recursive: true })
const out = `${dir}/${process.env.SNAPSHOT_NAME}.db`
const src = new DatabaseSync(db)
src.exec("PRAGMA busy_timeout = 10000")
src.prepare("VACUUM INTO ?").run(out)
src.close()
const copy = new DatabaseSync(out, { readOnly: true })
const ok = copy.prepare("PRAGMA integrity_check").get()
copy.close()
if (Object.values(ok)[0] !== "ok") throw new Error(`integrity_check on ${out}: ${JSON.stringify(ok)}`)
console.log(`snapshot: ${out}`)
const keep = Number(process.env.KEEP_SNAPSHOTS)
const all = fs.readdirSync(dir).filter((f) => f.endsWith(".db")).sort()
for (const f of all.slice(0, Math.max(0, all.length - keep))) {
  fs.rmSync(`${dir}/${f}`)
  console.log(`snapshot: removed old copy ${f}`)
}
'

snapshot() {
  local name
  name="$(date -u +%Y%m%dT%H%M%SZ)-${1:-none}-to-$2"
  log "pre-migration copy $name (keeping $KEEP_SNAPSHOTS)"
  RELEASE="$2" compose run --rm --no-deps -T \
    -e SNAPSHOT_NAME="$name" -e KEEP_SNAPSHOTS="$KEEP_SNAPSHOTS" -e NODE_NO_WARNINGS=1 \
    --entrypoint node migrate --input-type=module -e "$snapshot_js"
}

# --- commands ---------------------------------------------------------------------------------

cmd_deploy() {
  local tag="${1:-}" prev
  valid_tag "$tag" || die "usage: deploy.sh deploy <tag> (got '${tag}')"
  lock
  prev="$(current_release)"
  log "live: ${prev:-none}, deploying: $tag"

  if [[ "${DEPLOY_PULL:-1}" != 0 ]]; then
    log "pull $tag"
    if ! RELEASE="$tag" compose pull --quiet migrate web cms; then
      alert "pull of $tag failed. Nothing changed, ${prev:-nothing} is still live."
      exit 1
    fi
  fi

  if [[ "${DEPLOY_ASSETS:-0}" == 1 ]]; then
    log "upload static assets of $tag (infra/assets.sh)"
    if ! "$assets_cmd" upload "${IMAGE_PREFIX:-$PROJECT_NAME}/web:$tag" "$tag"; then
      alert "static asset upload of $tag failed. Nothing changed, ${prev:-nothing} is still live."
      exit 1
    fi
  fi

  if ! offsite_sync; then
    alert "Litestream sync failed before migrating $tag. Nothing changed, ${prev:-nothing} is still live."
    exit 1
  fi
  if ! snapshot "$prev" "$tag"; then
    alert "pre-migration DB copy failed for $tag. Nothing changed, ${prev:-nothing} is still live."
    exit 1
  fi

  log "migrate with $tag"
  if ! RELEASE="$tag" compose run --rm --no-deps -T migrate; then
    alert "migrations of $tag failed. Nothing swapped, ${prev:-nothing} is still live. The \
pre-migration copy is in the data directory under pre-migrate/ (infra/README.md, Deploy)."
    exit 1
  fi

  save_live_config "$prev" || log "WARNING could not keep the running config for $prev"
  if swap_and_check "$tag"; then
    record_release "$tag"
    prune_configs || log "WARNING could not remove old config folders (the deploy itself is fine)"
    if [[ "${DEPLOY_ASSETS:-0}" == 1 ]]; then
      # Keeps $tag and the previous LIVE release whatever their age.
      "$assets_cmd" prune --keep "$(live_releases | paste -sd, -)" ||
        log "WARNING: static asset prune failed (the deploy itself is fine)"
    fi
    log "$tag is live"
    return 0
  fi

  log "$tag failed its checks"
  if [[ -z "$prev" ]]; then
    alert "$tag failed its health or smoke checks and there is no previous release to go back to."
    exit 1
  fi
  if swap_and_check "$prev"; then
    alert "$tag failed its health or smoke checks. Rolled back to $prev, which passes."
  else
    alert "$tag failed its checks, and the rollback to $prev ALSO fails its checks. The site may be down."
  fi
  exit 1
}

cmd_rollback() {
  lock
  local lines cur target
  lines="$(wc -l <"$history_file" 2>/dev/null | tr -d ' ' || echo 0)"
  [[ "${lines:-0}" -ge 2 ]] || die "no previous release recorded in $history_file"
  cur="$(tail -n 1 "$history_file")"
  target="$(tail -n 2 "$history_file" | head -n 1)"
  log "manual rollback: $cur -> $target (no migrations; the schema stays as $cur left it)"
  if swap_and_check "$target"; then
    sed '$d' "$history_file" >"$history_file.tmp" && mv "$history_file.tmp" "$history_file"
    log "$target is live"
    return 0
  fi
  if swap_and_check "$cur"; then
    alert "manual rollback to $target failed its checks. Back on $cur, which passes."
  else
    alert "manual rollback to $target failed, and $cur ALSO fails its checks now. The site may be down."
  fi
  exit 1
}

# The previous live release and the live one (last line). Failed tags are never recorded.
live_releases() {
  [[ -s "$history_file" ]] && tail -n 2 "$history_file"
  return 0
}

cmd_status() {
  if [[ -s "$history_file" ]]; then
    cat "$history_file"
  else
    echo "no releases recorded in $history_file"
  fi
}

case "${1:-}" in
  deploy) cmd_deploy "${2:-}" ;;
  rollback) cmd_rollback ;;
  status) cmd_status ;;
  live-releases) live_releases ;;
  *) die "usage: deploy.sh deploy <tag> | rollback | status | live-releases" ;;
esac
