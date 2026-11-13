#!/usr/bin/env bash
# Expose cms and the preview instance on the tailnet only, with HTTPS from
# `tailscale serve` (ADR-0002). Idempotent: re-running replaces the same mappings.
#
# Loopback ports must match the Compose file (cms 127.0.0.1:3001, web-preview 127.0.0.1:3002).
# Override with env vars and keep them in sync with infra/compose.yaml.
set -euo pipefail

CMS_PORT="${CMS_PORT:-3001}"         # cms         -> https://<name>.<tailnet>.ts.net:9443/
PREVIEW_PORT="${PREVIEW_PORT:-3002}" # web-preview -> https://<name>.<tailnet>.ts.net:8443/
CMS_HTTPS_PORT="${CMS_HTTPS_PORT:-9443}" # not 443: Caddy publishes it, and tailscaled starts first on a reboot
PREVIEW_HTTPS_PORT="${PREVIEW_HTTPS_PORT:-8443}"
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h | --help)
      echo "Usage: infra/tailscale-serve.sh [--dry-run]"
      exit 0
      ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

for p in "$CMS_PORT" "$PREVIEW_PORT" "$CMS_HTTPS_PORT" "$PREVIEW_HTTPS_PORT"; do
  if ! [[ "$p" =~ ^[0-9]+$ ]] || ((p < 1 || p > 65535)); then
    echo "invalid port: $p" >&2
    exit 2
  fi
done

run() {
  if ((DRY_RUN)); then
    printf '[dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

if ! ((DRY_RUN)); then
  command -v tailscale >/dev/null 2>&1 || {
    echo "tailscale is not installed; run infra/bootstrap.sh first" >&2
    exit 1
  }
  tailscale status --json 2>/dev/null | grep -Eq '"BackendState": *"Running"' || {
    echo "tailscale is not up" >&2
    exit 1
  }
fi

# --bg keeps the mapping across reboots; the same --https port replaces its mapping.
run tailscale serve --bg --https="$CMS_HTTPS_PORT" "http://127.0.0.1:$CMS_PORT"
run tailscale serve --bg --https="$PREVIEW_HTTPS_PORT" "http://127.0.0.1:$PREVIEW_PORT"

if ! ((DRY_RUN)); then
  tailscale serve status
fi
