#!/usr/bin/env bash
# shellcheck disable=SC2329,SC2034
# Checks the end state of infra/bootstrap.sh. Runs INSIDE the test container/VM, as root.
# Usage: verify.sh <admin-user> [--test-no-tailscale]
set -uo pipefail

# The project name and time zone come from infra/project.env.
# shellcheck disable=SC1091
. "$(dirname "$0")/../project.sh"

user="${1:?admin user}"
test_mode="${2:-}"
fail=0
check() {
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    printf 'ok    %s\n' "$name"
  else
    printf 'FAIL  %s\n' "$name"
    fail=1
  fi
}
sshd_has() {
  local out
  out="$(sshd -T -C "user=$user,host=x,addr=1.1.1.1" 2>/dev/null)"
  grep -qix "$1" <<<"$out"
}
ufw_has() { ufw status | grep -Eq "$1"; }

check "sshd: no passwords" sshd_has "passwordauthentication no"
check "sshd: no kbd-interactive" sshd_has "kbdinteractiveauthentication no"
check "sshd: no root login" sshd_has "permitrootlogin no"
check "sshd: AllowUsers $user" sshd_has "allowusers $user"
check "admin key installed" test -s "/home/$user/.ssh/authorized_keys"
check "admin key file mode 600" test "$(stat -c %a "/home/$user/.ssh/authorized_keys")" = 600
check "ufw active" ufw_has '^Status: active'
check "ufw default deny incoming" sh -c "ufw status verbose | grep -q 'deny (incoming)'"
check "ufw 80 open" ufw_has '^80/tcp +ALLOW'
check "ufw 443 open" ufw_has '^443/tcp +ALLOW'
check "ufw 22 on tailscale0" ufw_has '^22/tcp on tailscale0 +ALLOW'
if [[ "$test_mode" == "--test-no-tailscale" ]]; then
  check "test mode: public 22 open" ufw_has '^22/tcp +ALLOW +Anywhere'
else
  check "public 22 closed" sh -c "! ufw status | grep -Eq '^22/tcp +ALLOW +Anywhere'"
fi
check "swap file 2G, mode 600" sh -c "test \$(stat -c %s /swapfile) -eq 2147483648 && test \$(stat -c %a /swapfile) = 600"
check "swap in fstab once" test "$(grep -c '^/swapfile' /etc/fstab)" = 1
check "docker active" systemctl is-active docker
check "docker compose plugin" docker compose version
check "docker live-restore on" sh -c "docker info 2>/dev/null | grep -q 'Live Restore Enabled: true'"
check "docker log rotation" sh -c "grep -q max-size /etc/docker/daemon.json"
check "app dirs" sh -c "test -d $APP_DIR/data && test -d $APP_DIR/env && test \$(stat -c %a $APP_DIR/env) = 700"
check "journald limit" grep -q '^SystemMaxUse=' "/etc/systemd/journald.conf.d/50-$PROJECT_NAME.conf"
check "time sync enabled" bash -c 'systemctl is-enabled systemd-timesyncd || systemctl is-enabled chrony'
check "u-u: no auto reboot" sh -c "apt-config dump | grep -q 'Unattended-Upgrade::Automatic-Reboot \"false\"'"
check "u-u: security origins only" sh -c "apt-config dump | grep 'Allowed-Origins' | grep -q security && ! apt-config dump | grep 'Allowed-Origins' | grep -Eq -- '-updates|-proposed|-backports'"
check "u-u: docker blacklisted" sh -c "apt-config dump | grep 'Package-Blacklist' | grep -q docker-ce && apt-config dump | grep 'Package-Blacklist' | grep -q containerd.io"
check "u-u: periodic enabled" sh -c "apt-config dump | grep -q 'APT::Periodic::Unattended-Upgrade \"1\"'"
check "needrestart list-only" grep -q "restart} = 'l'" "/etc/needrestart/conf.d/50-$PROJECT_NAME.conf"
check "reboot timer enabled" systemctl is-enabled "$PROJECT_NAME-reboot.timer"
check "reboot timer active" systemctl is-active "$PROJECT_NAME-reboot.timer"
check "reboot timer is Sun 04:00 $TIMEZONE" sh -c "systemctl cat $PROJECT_NAME-reboot.timer | grep -qx 'OnCalendar=Sun \*-\*-\* 04:00:00 $TIMEZONE'"
check "reboot calendar parses" systemd-analyze calendar "Sun *-*-* 04:00:00 $TIMEZONE"
check "reboot script no-op without flag" sh -c "rm -f /var/run/reboot-required; /usr/local/sbin/$PROJECT_NAME-reboot-if-needed"

exit "$fail"
