# 4. Docker Compose + Caddy on Ubuntu LTS, with a scripted bootstrap

Date: 2026-11-09 · Status: accepted

## Context
A server set up by hand drifts, and unattended restarts and reboots happen at unpredictable times.

## Decision
- A small VPS on an Ubuntu LTS release, rebuilt from zero by script.
- `infra/bootstrap.sh`: SSH keys only, SSH over Tailscale only, ufw with only 80/443 public, swap,
  Docker.
- Docker Compose runs `caddy`, `web`, `web-preview`, `cms` and `litestream`. Containers have memory
  limits, health checks and `restart: unless-stopped`.
- Security updates install automatically, but the app never restarts on its own. Reboots happen
  only in a fixed weekly window.
- No builds on the server.

## Consequences
Rebuilding a server is the bootstrap script plus a deploy. The scripts are in `infra/`.
