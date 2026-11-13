#!/usr/bin/env bash
# Turn a freshly formatted Ubuntu VPS into the hardened Docker host (ADR-0004).
# Idempotent: safe to run again. See infra/README.md for inputs, steps and recovery.
set -euo pipefail

# Per-project names (APP_DIR, DATA_DIR, ENV_DIR, TS_HOSTNAME, TIMEZONE, PROJECT_NAME) come from infra/project.env.
# shellcheck disable=SC1091
. "$(dirname "${BASH_SOURCE[0]}")/project.sh"

SWAP_FILE="${SWAP_FILE:-/swapfile}"
SWAP_SIZE="${SWAP_SIZE:-2G}"
REBOOT_TZ="$TIMEZONE"

ADMIN_USER="${ADMIN_USER:-}"
SSH_KEY="${SSH_KEY:-}" # a public key line, or a path to a .pub file
TS_AUTHKEY="${TS_AUTHKEY:-}"
# TS_HOSTNAME defaults to PROJECT_NAME (project.sh); --hostname overrides it.
DRY_RUN=0
TEST_NO_TAILSCALE=0

log() { printf '==> %s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<USAGE
Usage: sudo infra/bootstrap.sh --admin-user NAME --ssh-key KEY|FILE --hostname NAME [options]

Inputs (flag or environment variable; all four are required):
  --admin-user NAME     ADMIN_USER   admin account to create (key-only login)
  --ssh-key KEY|FILE    SSH_KEY      its public key, as a line or a path to a .pub file
  --hostname NAME       TS_HOSTNAME  hostname, also the Tailscale machine name
  --ts-authkey KEY      TS_AUTHKEY   Tailscale auth key (prefer the env var: flags show in ps)

Options:
  --dry-run             print every action, change nothing (needs no root)
  --test-no-tailscale   TEST ONLY: skip Tailscale and keep public port 22 open
  -h, --help
USAGE
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --admin-user) ADMIN_USER="${2:-}"; shift 2 ;;
      --ssh-key) SSH_KEY="${2:-}"; shift 2 ;;
      --hostname) TS_HOSTNAME="${2:-}"; shift 2 ;;
      --ts-authkey) TS_AUTHKEY="${2:-}"; shift 2 ;;
      --dry-run) DRY_RUN=1; shift ;;
      --test-no-tailscale) TEST_NO_TAILSCALE=1; shift ;;
      -h | --help) usage; exit 0 ;;
      *) usage >&2; die "unknown argument: $1" ;;
    esac
  done
}

# --- helpers ---------------------------------------------------------------

# Run a command, or only print it under --dry-run.
run() {
  if ((DRY_RUN)); then
    printf '  [dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

# write_file PATH MODE < content. Rewrites only when the content differs.
write_file() {
  local path="$1" mode="$2" tmp
  tmp="$(mktemp)"
  cat >"$tmp"
  if ((DRY_RUN)); then
    printf '  [dry-run] write %s (mode %s)\n' "$path" "$mode"
  elif [[ -f "$path" ]] && cmp -s "$tmp" "$path"; then
    chmod "$mode" "$path"
  else
    install -D -m "$mode" "$tmp" "$path"
  fi
  rm -f "$tmp"
}

# --- inputs ----------------------------------------------------------------

resolve_ssh_key() {
  local candidate="$SSH_KEY" keyfile
  [[ -f "$candidate" ]] && candidate="$(head -n1 "$candidate")"
  [[ "$candidate" == *"PRIVATE KEY"* ]] && die "--ssh-key looks like a private key; pass the public key"
  keyfile="$(mktemp)"
  printf '%s\n' "$candidate" >"$keyfile"
  if ! ssh-keygen -l -f "$keyfile" >/dev/null 2>&1; then
    rm -f "$keyfile"
    die "--ssh-key is not a valid SSH public key"
  fi
  rm -f "$keyfile"
  SSH_KEY="$candidate"
}

validate_inputs() {
  local missing=()
  [[ -n "$ADMIN_USER" ]] || missing+=("--admin-user / ADMIN_USER")
  [[ -n "$SSH_KEY" ]] || missing+=("--ssh-key / SSH_KEY")
  [[ -n "$TS_HOSTNAME" ]] || missing+=("--hostname / TS_HOSTNAME")
  if ((!TEST_NO_TAILSCALE)); then
    [[ -n "$TS_AUTHKEY" ]] || missing+=("--ts-authkey / TS_AUTHKEY")
  fi
  if ((${#missing[@]})); then
    usage >&2
    die "missing required input(s): ${missing[*]}"
  fi
  [[ "$ADMIN_USER" =~ ^[a-z][a-z0-9_-]{0,31}$ ]] || die "invalid admin user name: $ADMIN_USER"
  [[ "$ADMIN_USER" != "root" ]] || die "the admin user must not be root"
  [[ "$TS_HOSTNAME" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]] || die "invalid hostname: $TS_HOSTNAME"
  resolve_ssh_key
}

require_environment() {
  if ((DRY_RUN)); then
    return 0
  fi
  [[ "$(id -u)" -eq 0 ]] || die "run as root (sudo), or use --dry-run"
  [[ -r /etc/os-release ]] || die "cannot read /etc/os-release"
  # shellcheck disable=SC1091
  . /etc/os-release
  [[ "${ID:-}" == "ubuntu" ]] || die "this script supports Ubuntu only (found ${ID:-unknown})"
  case "${VERSION_ID:-}" in
    24.04 | 26.04) ;;
    *) warn "built for Ubuntu 26.04 (tested on 24.04 too); found ${VERSION_ID:-unknown}" ;;
  esac
}

print_recovery() {
  cat <<END_RECOVERY

----------------------------------------------------------------------------
RECOVERY PATH if you get locked out (read this before continuing)
  1. Hetzner Cloud Console -> your server -> "Console" (browser VNC).
     If no account can log in: Rescue mode, or "Reset root password".
  2. Log in as the admin user and reopen public SSH:
       sudo ufw allow 22/tcp
  3. To allow passwords again, delete /etc/ssh/sshd_config.d/00-$PROJECT_NAME.conf
     and run: sudo systemctl reload ssh
  Public SSH is closed only at the very end, and only after the lockout guard
  confirms Tailscale is up and the admin key is installed.
----------------------------------------------------------------------------

END_RECOVERY
}

# --- steps -----------------------------------------------------------------

step_packages() {
  log "Upgrading packages"
  export DEBIAN_FRONTEND=noninteractive
  run apt-get update -y
  run apt-get -y -o Dpkg::Options::=--force-confold upgrade
  run apt-get install -y ca-certificates curl gnupg ufw unattended-upgrades needrestart openssh-server
}

admin_home() {
  local home
  home="$(getent passwd "$ADMIN_USER" | cut -d: -f6 || true)"
  printf '%s' "${home:-/home/$ADMIN_USER}"
}

step_admin_user() {
  log "Admin user '$ADMIN_USER' (key-only)"
  if ((DRY_RUN)) || ! id "$ADMIN_USER" >/dev/null 2>&1; then
    run adduser --disabled-password --gecos "" "$ADMIN_USER"
  fi
  run usermod -aG sudo "$ADMIN_USER"
  # No password exists, so sudo must not ask for one.
  write_file "/etc/sudoers.d/90-$PROJECT_NAME-admin" 0440 <<EOF
$ADMIN_USER ALL=(ALL) NOPASSWD:ALL
EOF
  if ! ((DRY_RUN)); then visudo -cf "/etc/sudoers.d/90-$PROJECT_NAME-admin" >/dev/null; fi
  local ssh_dir auth
  ssh_dir="$(admin_home)/.ssh"
  auth="$ssh_dir/authorized_keys"
  run install -d -m 700 -o "$ADMIN_USER" -g "$ADMIN_USER" "$ssh_dir"
  if ((DRY_RUN)); then
    printf '  [dry-run] ensure key in %s\n' "$auth"
  else
    touch "$auth"
    grep -qxF "$SSH_KEY" "$auth" || printf '%s\n' "$SSH_KEY" >>"$auth"
    chown "$ADMIN_USER:$ADMIN_USER" "$auth"
    chmod 600 "$auth"
  fi
}

install_tailscale_package() {
  command -v tailscale >/dev/null 2>&1 && return 0
  local codename
  # shellcheck disable=SC1091
  codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"
  run install -d -m 755 /usr/share/keyrings
  run curl -fsSL "https://pkgs.tailscale.com/stable/ubuntu/${codename}.noarmor.gpg" -o /usr/share/keyrings/tailscale-archive-keyring.gpg
  run curl -fsSL "https://pkgs.tailscale.com/stable/ubuntu/${codename}.tailscale-keyring.list" -o /etc/apt/sources.list.d/tailscale.list
  run apt-get update -y
  run apt-get install -y tailscale
}

tailscale_is_up() {
  command -v tailscale >/dev/null 2>&1 || return 1
  tailscale status --json 2>/dev/null | grep -Eq '"BackendState": *"Running"' || return 1
  [[ -n "$(tailscale ip -4 2>/dev/null || true)" ]]
}

step_tailscale() {
  if ((TEST_NO_TAILSCALE)); then
    warn "TEST MODE: skipping Tailscale"
    return 0
  fi
  log "Tailscale (MagicDNS on)"
  install_tailscale_package
  run systemctl enable --now tailscaled
  if ((DRY_RUN)); then
    printf '  [dry-run] tailscale up --auth-key=<redacted> --hostname=%s --accept-dns=true\n' "$TS_HOSTNAME"
  elif tailscale_is_up; then
    log "Tailscale already up"
  else
    local keyfile
    keyfile="$(mktemp)"
    printf '%s' "$TS_AUTHKEY" >"$keyfile"
    if ! tailscale up --auth-key="file:$keyfile" --hostname="$TS_HOSTNAME" --accept-dns=true; then
      rm -f "$keyfile"
      die "tailscale up failed; SSH stays open, nothing was locked down"
    fi
    rm -f "$keyfile"
  fi
  # `tailscale serve` (infra/tailscale-serve.sh) runs as the admin user, not root.
  run tailscale set --operator="$ADMIN_USER"
}

admin_key_installed() {
  local auth
  auth="$(admin_home)/.ssh/authorized_keys"
  [[ -s "$auth" ]] && grep -qxF "$SSH_KEY" "$auth"
}

# Lockout guard. "key" gates sshd hardening; "tailscale" gates closing public 22.
# Returns non-zero (and says why) if it would be unsafe to continue.
lockout_guard() {
  local what="$1"
  if ((DRY_RUN)); then
    printf '  [dry-run] lockout guard (%s): would verify admin key installed' "$what"
    if [[ "$what" == tailscale ]]; then
      printf ', tailscale Running with an IPv4, sshd -t, tailscale0:22 rule'
    fi
    printf '\n'
    return 0
  fi
  admin_key_installed || {
    warn "lockout guard: key for $ADMIN_USER is not in authorized_keys"
    return 1
  }
  if [[ "$what" == tailscale ]]; then
    tailscale_is_up || {
      warn "lockout guard: Tailscale is not up (not Running, or no IPv4)"
      return 1
    }
    sshd -t || {
      warn "lockout guard: sshd config does not validate"
      return 1
    }
    ufw status | grep -Eq '^22/tcp on tailscale0 +ALLOW' || {
      warn "lockout guard: ufw has no 22/tcp rule on tailscale0"
      return 1
    }
  fi
  return 0
}

step_sshd() {
  log "Hardening sshd"
  lockout_guard key || die "refusing to disable password login without a working key"
  # 00- sorts first and sshd keeps the first value it sees, so this beats
  # cloud-init's 50-cloud-init.conf.
  write_file "/etc/ssh/sshd_config.d/00-$PROJECT_NAME.conf" 0644 <<EOF
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
AuthenticationMethods publickey
MaxAuthTries 3
X11Forwarding no
AllowUsers $ADMIN_USER
EOF
  if ((DRY_RUN)); then
    printf '  [dry-run] sshd -t && systemctl reload ssh\n'
  else
    install -d -m 755 /run/sshd # sshd -t needs it even when ssh is not running yet
    sshd -t || die "sshd config invalid; not reloading"
    systemctl reload ssh 2>/dev/null || systemctl restart ssh
  fi
}

step_ufw() {
  log "ufw: deny by default, 80/443 open, 22 on tailscale0 only"
  run ufw default deny incoming
  run ufw default allow outgoing
  run ufw allow 80/tcp
  run ufw allow 443/tcp
  run ufw allow in on tailscale0 to any port 22 proto tcp
  # Keep public 22 open while ufw is first switched on (so this very session
  # survives), and always in test mode. Closed later by step_close_public_ssh.
  if ((TEST_NO_TAILSCALE)) || ((DRY_RUN)) || ufw status | grep -q '^Status: inactive'; then
    run ufw allow 22/tcp
  fi
  run ufw --force enable
}

step_close_public_ssh() {
  if ((TEST_NO_TAILSCALE)); then
    warn "TEST MODE: public port 22 stays open"
    return 0
  fi
  log "Closing public SSH"
  lockout_guard tailscale || die "lockout guard failed: public SSH left OPEN. Fix the problem above and re-run."
  if ((DRY_RUN)); then
    printf '  [dry-run] ufw delete allow 22/tcp (if present)\n'
  elif ufw status | grep -Eq '^22/tcp +ALLOW +Anywhere'; then
    ufw --force delete allow 22/tcp
  fi
}

step_swap() {
  log "Swap ($SWAP_SIZE)"
  if ((DRY_RUN)); then
    printf '  [dry-run] create %s (%s), mkswap, swapon, fstab, vm.swappiness=10\n' "$SWAP_FILE" "$SWAP_SIZE"
    return 0
  fi
  if [[ ! -f "$SWAP_FILE" ]]; then
    fallocate -l "$SWAP_SIZE" "$SWAP_FILE" || dd if=/dev/zero of="$SWAP_FILE" bs=1M count=$((${SWAP_SIZE%G} * 1024))
    chmod 600 "$SWAP_FILE"
    mkswap "$SWAP_FILE" >/dev/null
  fi
  swapon --show=NAME --noheadings | grep -qxF "$SWAP_FILE" || swapon "$SWAP_FILE" || warn "swapon failed (container?)"
  grep -qE "^${SWAP_FILE}[[:space:]]" /etc/fstab || printf '%s none swap sw 0 0\n' "$SWAP_FILE" >>/etc/fstab
  write_file "/etc/sysctl.d/60-$PROJECT_NAME-swap.conf" 0644 <<EOF
vm.swappiness=10
EOF
  sysctl -q -p "/etc/sysctl.d/60-$PROJECT_NAME-swap.conf" || true
}

step_docker() {
  log "Docker with compose plugin"
  if ((DRY_RUN)) || ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    local codename arch
    # shellcheck disable=SC1091
    codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"
    arch="$(dpkg --print-architecture 2>/dev/null || echo amd64)"
    run install -d -m 755 /etc/apt/keyrings
    run curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    run chmod a+r /etc/apt/keyrings/docker.asc
    write_file /etc/apt/sources.list.d/docker.list 0644 <<EOF
deb [arch=$arch signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $codename stable
EOF
    run apt-get update -y
    run apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  write_file /etc/docker/daemon.json 0644 <<'EOF'
{
  "live-restore": true,
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
  run systemctl enable docker
  # live-restore is applied on a daemon reload, so running containers are not restarted.
  if ((DRY_RUN)); then
    printf '  [dry-run] systemctl reload docker (start it if not running)\n'
  elif systemctl is-active --quiet docker; then
    systemctl reload docker || warn "docker reload failed; changes apply at the next daemon restart"
  else
    systemctl start docker
  fi
  run usermod -aG docker "$ADMIN_USER"
}

step_app_dir() {
  log "App directory $APP_DIR"
  run install -d -m 755 -o "$ADMIN_USER" -g "$ADMIN_USER" "$APP_DIR"
  run install -d -m 750 -o "$ADMIN_USER" -g "$ADMIN_USER" "$DATA_DIR"
  run install -d -m 700 -o "$ADMIN_USER" -g "$ADMIN_USER" "$ENV_DIR"
}

step_system_services() {
  log "journald limits and time sync"
  write_file "/etc/systemd/journald.conf.d/50-$PROJECT_NAME.conf" 0644 <<'EOF'
[Journal]
SystemMaxUse=200M
RuntimeMaxUse=50M
MaxRetentionSec=1month
EOF
  run systemctl restart systemd-journald
  run timedatectl set-ntp true
  # Ubuntu 26.04 ships chrony; 24.04 ships systemd-timesyncd. Enable whichever is installed.
  local unit
  for unit in systemd-timesyncd chrony; do
    if systemctl cat "$unit.service" >/dev/null 2>&1; then
      run systemctl enable --now "$unit"
      break
    fi
  done
}

step_no_auto_restart() {
  log "Unattended upgrades: security only, no auto reboot, Docker held back"
  write_file /etc/apt/apt.conf.d/20auto-upgrades 0644 <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
  # "#clear" empties the lists Ubuntu ships in 50unattended-upgrades.
  write_file "/etc/apt/apt.conf.d/52$PROJECT_NAME-unattended" 0644 <<'EOF'
#clear Unattended-Upgrade::Allowed-Origins;
#clear Unattended-Upgrade::Package-Blacklist;
Unattended-Upgrade::Allowed-Origins {
        "${distro_id}:${distro_codename}-security";
        "${distro_id}ESMApps:${distro_codename}-apps-security";
        "${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::Package-Blacklist {
        "docker-ce";
        "docker-ce-cli";
        "docker-ce-rootless-extras";
        "docker-buildx-plugin";
        "docker-compose-plugin";
        "containerd.io";
};
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Dependencies "false";
EOF
  # needrestart: list services needing a restart, never restart them.
  write_file "/etc/needrestart/conf.d/50-$PROJECT_NAME.conf" 0644 <<'EOF'
$nrconf{restart} = 'l';
$nrconf{kernelhints} = -1;
EOF

  log "Sunday 04:00 $REBOOT_TZ reboot window (only when a reboot is required)"
  write_file "/usr/local/sbin/$PROJECT_NAME-reboot-if-needed" 0755 <<EOF
#!/bin/sh
# Reboot only if the system says a reboot is required (kernel, libc, ...).
if [ -f /var/run/reboot-required ]; then
  logger -t $PROJECT_NAME-reboot "reboot required; rebooting"
  exec /usr/bin/systemctl reboot
fi
logger -t $PROJECT_NAME-reboot "no reboot required"
EOF
  write_file "/etc/systemd/system/$PROJECT_NAME-reboot.service" 0644 <<EOF
[Unit]
Description=Reboot if required (weekly window)

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/$PROJECT_NAME-reboot-if-needed
EOF
  write_file "/etc/systemd/system/$PROJECT_NAME-reboot.timer" 0644 <<EOF
[Unit]
Description=Sunday 04:00 $REBOOT_TZ reboot window

[Timer]
OnCalendar=Sun *-*-* 04:00:00 $REBOOT_TZ
Persistent=false

[Install]
WantedBy=timers.target
EOF
  run systemctl daemon-reload
  run systemctl enable --now "$PROJECT_NAME-reboot.timer"
}

main() {
  parse_args "$@"
  validate_inputs
  require_environment
  if ((DRY_RUN)); then log "DRY RUN: nothing will be changed"; fi
  print_recovery
  step_packages
  step_admin_user
  step_ufw
  step_tailscale
  step_sshd
  step_swap
  step_docker
  step_app_dir
  step_system_services
  step_no_auto_restart
  step_close_public_ssh
  log "Done. Next: infra/tailscale-serve.sh, then push a release tag (see README.md, Deploy)."
}

# Tests source this file to call single functions; only run main when executed.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
