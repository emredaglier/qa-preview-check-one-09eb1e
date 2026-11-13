#!/usr/bin/env bash
# Run infra/bootstrap.sh twice in a throwaway systemd Ubuntu container and check the result.
# Not a VM: no real Tailscale, no kernel swap. See infra/README.md "Testing".
# Usage: infra/test/run.sh [ubuntu-version]   (default 26.04)
set -euo pipefail

version="${1:-26.04}"
here="$(cd "$(dirname "$0")" && pwd)"
infra="$(dirname "$here")"
# shellcheck disable=SC1091
. "$infra/project.sh"
name="$PROJECT_NAME-bootstrap-test-$$"
image="$PROJECT_NAME-bootstrap-test:$version"

docker build -q -t "$image" --build-arg "UBUNTU=$version" "$here" >/dev/null
docker run -d --name "$name" --privileged --cgroupns=host \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw --tmpfs /run --tmpfs /run/lock \
  -v "$infra:/infra:ro" "$image" >/dev/null
trap 'docker rm -f "$name" >/dev/null' EXIT

for _ in $(seq 1 30); do
  state="$(docker exec "$name" systemctl is-system-running 2>/dev/null || true)"
  [[ "$state" == running || "$state" == degraded ]] && break
  sleep 1
done

args=(--test-no-tailscale --admin-user deploy --ssh-key /root/testkey.pub --hostname "$PROJECT_NAME-vps")
echo "== run 1"
docker exec "$name" /infra/bootstrap.sh "${args[@]}" >/dev/null
echo "== run 2 (idempotency)"
docker exec "$name" /infra/bootstrap.sh "${args[@]}" >/dev/null
echo "== verify"
docker exec "$name" /infra/test/verify.sh deploy --test-no-tailscale
echo "== inputs and lockout guard"
docker exec "$name" /infra/test/guard-test.sh deploy /root/testkey.pub /root/testkey
echo "all passed"
