#!/usr/bin/env bash
# shellcheck disable=SC2329,SC2034
# Tests input validation and the lockout guard of infra/bootstrap.sh.
# Runs INSIDE the test container/VM, as root, AFTER a --test-no-tailscale run
# (so ufw is active and the admin user and key exist). It then closes public
# 22 in the container, so run it last. Usage: guard-test.sh <admin-user> <pubkey-file> <privkey-file>
set -uo pipefail

user="${1:?admin user}"
pub="${2:?public key file}"
priv="${3:?private key file}"
script="$(dirname "$0")/../bootstrap.sh"
fail=0

expect() { # expect "<name>" <rc-predicate: zero|nonzero> -- command...
  local name="$1" want="$2"
  shift 3
  local out rc
  out="$("$@" 2>&1)"
  rc=$?
  if { [[ "$want" == zero ]] && ((rc == 0)); } || { [[ "$want" == nonzero ]] && ((rc != 0)); }; then
    printf 'ok    %s\n' "$name"
  else
    printf 'FAIL  %s (rc=%s)\n%s\n' "$name" "$rc" "$out"
    fail=1
  fi
}
public22() { ufw status | grep -Eq '^22/tcp +ALLOW +Anywhere'; }
ts22() { ufw status | grep -Eq '^22/tcp on tailscale0 +ALLOW'; }

# --- input validation: fail fast -------------------------------------------
base=(--admin-user "$user" --ssh-key "$pub" --hostname testhost --ts-authkey tskey-x --dry-run)
expect "all inputs ok (dry-run)" zero -- "$script" "${base[@]}"
expect "missing admin user" nonzero -- "$script" --ssh-key "$pub" --hostname h --ts-authkey k --dry-run
expect "missing ssh key" nonzero -- "$script" --admin-user "$user" --hostname h --ts-authkey k --dry-run
# The Tailscale name defaults to PROJECT_NAME (infra/project.env), so no hostname is fine.
expect "hostname defaults to the project name" zero -- "$script" --admin-user "$user" --ssh-key "$pub" --ts-authkey k --dry-run
expect "missing tailscale key" nonzero -- "$script" --admin-user "$user" --ssh-key "$pub" --hostname h --dry-run
expect "tailscale key not needed in test mode" zero -- "$script" --admin-user "$user" --ssh-key "$pub" --hostname h --test-no-tailscale --dry-run
expect "private key rejected" nonzero -- "$script" --admin-user "$user" --ssh-key "$priv" --hostname h --ts-authkey k --dry-run
expect "garbage key rejected" nonzero -- "$script" --admin-user "$user" --ssh-key "not a key" --hostname h --ts-authkey k --dry-run
expect "root as admin rejected" nonzero -- "$script" --admin-user root --ssh-key "$pub" --hostname h --ts-authkey k --dry-run
expect "unknown flag rejected" nonzero -- "$script" --bogus

# --- lockout guard ----------------------------------------------------------
# shellcheck disable=SC1090
source "$script"
set +e
ADMIN_USER="$user"
SSH_KEY="$(head -n1 "$pub")"
DRY_RUN=0
TEST_NO_TAILSCALE=0

public22 || {
  echo "precondition: public 22 must be open before this test"
  exit 2
}

# 1. Tailscale not up (it is not installed here): the guard refuses, 22 stays open.
expect "guard refuses when tailscale is down" nonzero -- bash -c "source '$script'; ADMIN_USER='$user'; SSH_KEY='$SSH_KEY'; step_close_public_ssh"
expect "public 22 still open after refused close" zero -- public22

# 2. Admin key missing: guard 'key' refuses, so sshd hardening does not run.
cp "/home/$user/.ssh/authorized_keys" /root/ak.bak
: >"/home/$user/.ssh/authorized_keys"
expect "guard refuses when key is missing" nonzero -- bash -c "source '$script'; ADMIN_USER='$user'; SSH_KEY='$SSH_KEY'; step_sshd"
expect "guard refuses close when key is missing" nonzero -- bash -c "source '$script'; ADMIN_USER='$user'; SSH_KEY='$SSH_KEY'; tailscale_is_up() { return 0; }; step_close_public_ssh"
expect "public 22 still open with key missing" zero -- public22
cp /root/ak.bak "/home/$user/.ssh/authorized_keys"
chown "$user:$user" "/home/$user/.ssh/authorized_keys"
chmod 600 "/home/$user/.ssh/authorized_keys"

# 3. Tailscale reported up, key present, tailscale0 rule present: public 22 closes.
expect "tailscale0:22 rule exists" zero -- ts22
expect "guard passes when all conditions hold" zero -- bash -c "source '$script'; ADMIN_USER='$user'; SSH_KEY='$SSH_KEY'; tailscale_is_up() { return 0; }; step_close_public_ssh"
expect "public 22 closed" nonzero -- public22
expect "tailscale0:22 kept" zero -- ts22
expect "closing again is a no-op" zero -- bash -c "source '$script'; ADMIN_USER='$user'; SSH_KEY='$SSH_KEY'; tailscale_is_up() { return 0; }; step_close_public_ssh"

# 4. tailscale0 rule missing: guard refuses even with tailscale up.
ufw --force delete allow in on tailscale0 to any port 22 proto tcp >/dev/null
ufw allow 22/tcp >/dev/null
expect "guard refuses without the tailscale0 rule" nonzero -- bash -c "source '$script'; ADMIN_USER='$user'; SSH_KEY='$SSH_KEY'; tailscale_is_up() { return 0; }; step_close_public_ssh"
expect "public 22 still open without tailscale0 rule" zero -- public22

exit "$fail"
