#!/usr/bin/env bash
# Hook for the deploy: flush everything written so far to the backup bucket and wait
# for it, e.g. right before migrations run, so a bad migration can be rolled back to this moment
# with `restore.sh -timestamp <time printed by the deploy>`. Extra args go to `docker compose`
# (for example `-f infra/compose.yaml`).
#
#   infra/litestream/snapshot.sh [compose args]
# Exit 0 only if the replica is up to date. A non-zero exit means: do not migrate.
set -euo pipefail
exec docker compose "$@" exec -T litestream litestream sync -wait -timeout 60 \
  -socket /var/run/litestream/litestream.sock /data/site.db
