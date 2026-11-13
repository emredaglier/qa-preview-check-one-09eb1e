#!/usr/bin/env bash
# Restore the database from the backup bucket into an EMPTY directory (runbook:
# infra/README.md, "Backups: Litestream"). Uses the settings of the litestream service.
#
#   infra/litestream/restore.sh [compose args --] <empty-dir> [litestream restore flags]
#   infra/litestream/restore.sh -f infra/compose.yaml -- /opt/<project>/restored -timestamp 2026-11-01T10:00:00Z
set -euo pipefail

compose=()
if [[ " $* " == *" -- "* ]]; then
  while [[ "$1" != "--" ]]; do compose+=("$1"); shift; done
  shift
fi
dir="${1:?usage: restore.sh [compose args --] <empty-dir> [restore flags]}"
shift

mkdir -p "$dir"
[[ -z "$(ls -A "$dir")" ]] || { echo "restore: $dir is not empty" >&2; exit 1; }
dir="$(cd "$dir" && pwd)"

docker compose ${compose[@]+"${compose[@]}"} run --rm --no-deps --user root -v "$dir:/restore" litestream \
  restore -config /etc/litestream/litestream.yml -o /restore/site.db "$@" /data/site.db
chown 10001:10001 "$dir" "$dir"/site.db* 2>/dev/null \
  || echo "restore: now run: sudo chown 10001:10001 $dir $dir/site.db*"
echo "restore: wrote $dir/site.db"
