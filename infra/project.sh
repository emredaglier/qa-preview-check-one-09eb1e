#!/usr/bin/env bash
# Per-project settings for the shell scripts: `. "$here/project.sh"`.
#
# Reads infra/project.env (or $PROJECT_ENV_FILE), exports every setting and fills in the derived
# names (server folders, CDN origin, R2 bucket names). The file is parsed, never evaluated. A
# variable that is already set in the environment wins over the file. infra/settings.ts does the
# same for TypeScript; infra/project.test.ts checks that the two agree.
#
# Exports: PROJECT_NAME DOMAIN CDN_HOST CDN_ORIGIN TS_HOSTNAME TIMEZONE APP_DIR ENV_DIR DATA_DIR
#          CERTS_DIR STATE_DIR R2_MEDIA_BUCKET R2_DB_BACKUP_BUCKET R2_MEDIA_BACKUP_BUCKET
# Functions: require_configured  (fails while DOMAIN is still the template's example.com)
#            valid_release_name <name>  (the one pattern for an image tag and a CDN folder name;
#            infra/settings.ts has the same, and project.test.ts checks that they agree)

_project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_project_file="${PROJECT_ENV_FILE:-$_project_dir/project.env}"

_project_fail() {
  printf 'project.sh: %s\n' "$*" >&2
  exit 1
}

[[ -f "$_project_file" ]] || _project_fail "settings file $_project_file not found"

while IFS= read -r _line || [[ -n "$_line" ]]; do
  [[ "$_line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
  _key="${BASH_REMATCH[1]}"
  _value="${BASH_REMATCH[2]}"
  _value="${_value#"${_value%%[![:space:]]*}"}"
  _value="${_value%"${_value##*[![:space:]]}"}"
  case "$_key" in
    PROJECT_NAME | DOMAIN | CDN_HOST | CDN_ORIGIN | TS_HOSTNAME | TIMEZONE | APP_DIR | ENV_DIR | \
      DATA_DIR | CERTS_DIR | STATE_DIR | R2_MEDIA_BUCKET | R2_DB_BACKUP_BUCKET | R2_MEDIA_BACKUP_BUCKET)
      # Only a non-empty value counts as set, like settings.ts.
      [[ -n "${!_key:-}" ]] || export "$_key=$_value"
      ;;
  esac
done <"$_project_file"
unset _line _key _value

[[ "${PROJECT_NAME:-}" =~ ^[a-z][a-z0-9-]{1,30}$ ]] ||
  _project_fail "PROJECT_NAME must be 2-31 lowercase letters, digits or hyphens, starting with a letter (got '${PROJECT_NAME:-}'). Edit $_project_file."
[[ "${DOMAIN:-}" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] ||
  _project_fail "DOMAIN must be a bare host name such as example.com (got '${DOMAIN:-}'). Edit $_project_file."

: "${CDN_HOST:=cdn.$DOMAIN}"
: "${CDN_ORIGIN:=https://$CDN_HOST}"
: "${TS_HOSTNAME:=$PROJECT_NAME}"
: "${TIMEZONE:=UTC}"
: "${APP_DIR:=/opt/$PROJECT_NAME}"
: "${ENV_DIR:=$APP_DIR/env}"
: "${DATA_DIR:=$APP_DIR/data}"
: "${CERTS_DIR:=$APP_DIR/certs}"
: "${STATE_DIR:=$APP_DIR/state}"
: "${R2_MEDIA_BUCKET:=$PROJECT_NAME-media}"
: "${R2_DB_BACKUP_BUCKET:=$PROJECT_NAME-db-backups}"
: "${R2_MEDIA_BACKUP_BUCKET:=$PROJECT_NAME-backup}"
export PROJECT_NAME DOMAIN CDN_HOST CDN_ORIGIN TS_HOSTNAME TIMEZONE APP_DIR ENV_DIR DATA_DIR \
  CERTS_DIR STATE_DIR R2_MEDIA_BUCKET R2_DB_BACKUP_BUCKET R2_MEDIA_BACKUP_BUCKET

RELEASE_NAME_PATTERN='^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
valid_release_name() { [[ "${1:-}" =~ $RELEASE_NAME_PATTERN ]]; }

# The template ships with example.com. Anything that touches the real world (deploy, Cloudflare,
# the server) calls this first, so an unfilled project cannot reach it.
require_configured() {
  if [[ "$DOMAIN" == example.com || "$DOMAIN" == *.example.com ]]; then
    printf 'project.sh: DOMAIN is still the template placeholder (%s). Fill in %s first.\n' \
      "$DOMAIN" "$_project_file" >&2
    return 1
  fi
}
