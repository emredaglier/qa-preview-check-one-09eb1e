#!/usr/bin/env bash
# Every CI step as a script you can run locally (ADR-0005). The workflow
# (.github/workflows/ci.yml) only orchestrates: checkout, tool setup, then one call here.
#
#   infra/ci.sh lint-workflows        actionlint on .github/workflows (local binary, else Docker)
#   infra/ci.sh check                 workflow lint + pnpm lint, check:assets (asset-weight budget),
#                                     typecheck, test
#   infra/ci.sh verify-release <tag>  fail unless HEAD is on origin/main (a release is cut from main only)
#   infra/ci.sh build <id>            web, cms and migrate images for linux/amd64, tagged <id>
#   infra/ci.sh smoke <id> [args]     pnpm smoke against the already built web image; a release tag
#                                     leaves out the self-tests of the checks; args go to Playwright
#   infra/ci.sh publish <tag>         push the <tag> images to the registry; print each pushed digest
#                                     as <target>=<prefix>/<target>@sha256:... (also to $GITHUB_OUTPUT)
#   infra/ci.sh gate <group>          print ready=true|false (also to $GITHUB_OUTPUT) depending on
#                                     whether the secrets of <group> (upload | deploy) are all set
#   infra/ci.sh upload <tag>          static files of $WEB_IMAGE (a published digest) to the CDN
#   infra/ci.sh push <tag>            move the `latest` tags to $WEB_IMAGE, $CMS_IMAGE, $MIGRATE_IMAGE
#                                     (published digests), registry-side, without pulling
#   infra/ci.sh deploy <tag>          copy infra/ to the server as releases/<tag>/, run that
#                                     deploy.sh, then prune static releases except the live ones
#
# <id> is a release tag, or a git sha (pull requests and main build only the web image, with
# CI_TARGETS=web, and smoke-test it: ADR-0012). <tag> is a release tag such as v1.2.3: only a tag is
# ever published, uploaded or deployed. The tag names the images, the CDN folder
# (releases/<tag>) and the deploy, so a tag is never reused.
#
# Env:
#   IMAGE_PREFIX         default ghcr.io/<GITHUB_REPOSITORY_OWNER, lowercased>/<PROJECT_NAME>, else <PROJECT_NAME>
#   PROJECT_NAME, DOMAIN, CDN_ORIGIN, R2 bucket names, APP_DIR: from infra/project.env (project.sh)
#   CI_BUILD_CACHE_DIR   build: local buildx cache directory (CI restores it with actions/cache)
#   CI_TARGETS           build only: the images to make, default "web cms migrate"; the pull request gate sets "web"
#   CI_PLATFORM          build: docker platform, default linux/amd64 (set the native one for a quick local run)
#   IMAGE_SIZE_LIMIT_MB  build: warn above this size, default 300
#   R2_ACCOUNT_ID, R2_MEDIA_WRITE_KEY_ID, R2_MEDIA_WRITE_SECRET   upload, deploy (prune)
#   GHCR_TOKEN, GITHUB_ACTOR                                       publish, upload, push, deploy
#   WEB_IMAGE, CMS_IMAGE, MIGRATE_IMAGE  upload (web only), push: the digests publish printed
#   DEPLOY_HOST, DEPLOY_USER, DEPLOY_SSH_KEY, DEPLOY_HOST_KEY      deploy
#   DEPLOY_DIR           directory on the server, default <APP_DIR>/infra
#   ASSETS_CMD           the assets script, default infra/assets.sh (a test stands in for it)
# Secrets are documented in infra/README.md ("CI secrets").
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(dirname "$here")"
# shellcheck disable=SC1091
. "$here/project.sh"
targets=(web cms migrate)
# Replaceable in tests, like deploy.sh's ASSETS_CMD.
assets_cmd="${ASSETS_CMD:-$here/assets.sh}"
ACTIONLINT_IMAGE="rhysd/actionlint:1.7.7"

die() { echo "ci.sh: $*" >&2; exit 1; }
log() { echo "[ci] $*"; }
# A release tag: v1.2.3, optionally with a pre-release suffix (v1.2.3-rc.1).
# It must also be a valid release name (project.sh), the pattern deploy.sh and assets.sh use.
release_arg() {
  if [[ "${1:-}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] && valid_release_name "$1"; then return 0; fi
  die "usage: ci.sh $cmd <release tag, e.g. v1.2.3>"
}
# A build id: a git sha (pull requests, main) or a release tag.
build_arg() { [[ "${1:-}" =~ ^[0-9a-f]{7,40}$ ]] || release_arg "$@"; }

prefix() {
  if [ -n "${IMAGE_PREFIX:-}" ]; then echo "$IMAGE_PREFIX"
  elif [ -n "${GITHUB_REPOSITORY_OWNER:-}" ]; then echo "ghcr.io/${GITHUB_REPOSITORY_OWNER,,}/$PROJECT_NAME"
  else echo "$PROJECT_NAME"; fi
}

# Log in to the registry of the image prefix (ghcr.io in CI) with the job's token.
registry_login() {
  : "${GHCR_TOKEN:?}" "${GITHUB_ACTOR:?}"
  local p; p="$(prefix)"
  printf '%s' "$GHCR_TOKEN" | docker login "${p%%/*}" -u "$GITHUB_ACTOR" --password-stdin
}

# A group is ready only when every variable in it is non-empty.
group_vars() {
  case "$1" in
    upload) echo R2_ACCOUNT_ID R2_MEDIA_WRITE_KEY_ID R2_MEDIA_WRITE_SECRET ;;
    deploy) echo DEPLOY_HOST DEPLOY_USER DEPLOY_SSH_KEY DEPLOY_HOST_KEY TS_OAUTH_CLIENT_ID TS_OAUTH_SECRET \
              R2_ACCOUNT_ID R2_MEDIA_WRITE_KEY_ID R2_MEDIA_WRITE_SECRET ;;
    *) die "unknown gate group '$1' (upload | deploy)" ;;
  esac
}

cmd="${1:-}"
if [ $# -gt 0 ]; then shift; fi

case "$cmd" in
  lint-workflows)
    cd "$root"
    if command -v actionlint >/dev/null 2>&1; then
      actionlint .github/workflows/*.yml
    else
      docker run --rm -v "$root:/repo" -w /repo "$ACTIONLINT_IMAGE" -color
    fi
    ;;

  check)
    cd "$root"
    "$here/ci.sh" lint-workflows
    pnpm lint
    pnpm check:assets
    pnpm typecheck
    pnpm test
    ;;

  verify-release)
    release_arg "${1:-}"
    # A project that still has the template's placeholder settings cannot cut a release.
    require_configured || exit 1
    cd "$root"
    # A release is cut from main only. The tagged commit must already be in main's history, so a
    # tag on an unreviewed branch deploys nothing. (`check` fetches full history for this.)
    git rev-parse --verify --quiet "refs/remotes/origin/main" >/dev/null ||
      die "origin/main is not available: fetch the full history"
    git merge-base --is-ancestor HEAD "refs/remotes/origin/main" ||
      die "$1 is not on main: a release is tagged on a commit that is already in main"
    log "$1 is on main"
    ;;

  build)
    build_arg "${1:-}"; release="$1"; p="$(prefix)"
    # The images to make: all of them, unless CI_TARGETS names fewer (the pull request gate builds web only).
    read -ra build_targets <<<"${CI_TARGETS:-${targets[*]}}"
    for t in "${build_targets[@]}"; do
      case " ${targets[*]} " in *" $t "*) ;; *) die "unknown CI_TARGETS entry '$t' (web | cms | migrate)" ;; esac
    done
    cd "$root"
    read -ra args <<<"$("$assets_cmd" build-args "$release")"
    cache=()
    if [ -n "${CI_BUILD_CACHE_DIR:-}" ]; then
      mkdir -p "$CI_BUILD_CACHE_DIR"
      cache=(--cache-from "type=local,src=$CI_BUILD_CACHE_DIR" --cache-to "type=local,dest=$CI_BUILD_CACHE_DIR.new,mode=max")
    fi
    # The same build args for every target keep the shared `build` stage one cached layer. Only
    # web reads them. The cache is rotated afterwards, or it grows with every run.
    for t in "${build_targets[@]}"; do
      log "building $t for ${CI_PLATFORM:-linux/amd64}"
      docker buildx build --platform "${CI_PLATFORM:-linux/amd64}" --target "$t" "${args[@]}" ${cache[@]+"${cache[@]}"} \
        -t "$p/$t:$release" --load .
    done
    if [ -n "${CI_BUILD_CACHE_DIR:-}" ] && [ -d "$CI_BUILD_CACHE_DIR.new" ]; then
      rm -rf "$CI_BUILD_CACHE_DIR"
      mv "$CI_BUILD_CACHE_DIR.new" "$CI_BUILD_CACHE_DIR"
    fi
    # Recheck sizes on amd64. A warning, not a failure: the owner decides what to do.
    limit="${IMAGE_SIZE_LIMIT_MB:-300}"
    docker image ls --format 'table {{.Repository}}\t{{.Tag}}\t{{.Size}}' "$p/*"
    for t in "${build_targets[@]}"; do
      [ "$t" != migrate ] || continue
      # The size `docker image ls` prints (what the size target is measured in). `inspect .Size` is the
      # compressed size on the containerd image store, so it would understate this.
      size="$(docker image ls --format '{{.Size}}' "$p/$t:$release")"
      case "$size" in
        *GB) mb="$(awk -v s="${size%GB}" 'BEGIN { printf "%d", s * 1000 }')" ;;
        *MB) mb="$(awk -v s="${size%MB}" 'BEGIN { printf "%d", s }')" ;;
        *kB) mb=0 ;;
        *) die "cannot read the size of $t: '$size'" ;;
      esac
      log "$t image: ${mb} MB (target ${limit} MB)"
      if [ "$mb" -gt "$limit" ]; then echo "::warning title=Image size::$t is ${mb} MB, over the ${limit} MB target"; fi
      if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "- \`$t\`: ${mb} MB (target ${limit} MB)" >>"$GITHUB_STEP_SUMMARY"; fi
    done
    ;;

  publish)
    release_arg "${1:-}"; release="$1"; p="$(prefix)"
    require_configured || exit 1
    registry_login
    # The digest `docker push` ends with is the one the registry stores: later jobs pull and tag
    # exactly that, so the deployed bytes are the smoke-tested ones (ADR-0005).
    for t in "${targets[@]}"; do
      out="$(docker push "$p/$t:$release")" || die "docker push $p/$t:$release failed"
      echo "$out"
      digest="$(sed -n 's/.*digest: \(sha256:[0-9a-f]\{64\}\).*/\1/p' <<<"$out" | tail -1)"
      [ -n "$digest" ] || die "no digest in the output of docker push $p/$t:$release"
      log "$t: $p/$t@$digest"
      if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "$t=$p/$t@$digest" >>"$GITHUB_OUTPUT"; fi
    done
    ;;

  smoke)
    build_arg "${1:-}"; release="$1"; shift
    cd "$root"
    # A release tag runs the same checks of the page (routes, accessibility, secrets, WebGL), but
    # not the self-tests of the check code (smoke/checks.selftest.spec.ts): those ran on the pull
    # request and on main, and a tag is cut from main (ADR-0012).
    filter=()
    if [[ "$release" == v* ]]; then filter=(--grep-invert "check self-test"); fi
    # The browser requests /_next/ from the CDN prefix the image was built with; the smoke runner
    # answers those requests from the container, so nothing leaves the machine.
    SMOKE_WEB_IMAGE="$(prefix)/web:$release" \
      SMOKE_ASSET_PREFIX="$("$assets_cmd" asset-prefix "$release")" \
      pnpm smoke ${filter[@]+"${filter[@]}"} "$@"
    ;;

  gate)
    group="${1:-}"; [ -n "$group" ] || die "usage: ci.sh gate <upload|deploy>"
    names="$(group_vars "$group")" || exit 1
    missing=()
    for v in $names; do [ -n "${!v:-}" ] || missing+=("$v"); done
    if [ ${#missing[@]} -gt 0 ]; then
      echo "Skipping $group: secrets not set yet (${missing[*]}). The owner adds them (infra/README.md, "CI secrets")."
      ready=false
    else
      ready=true
    fi
    echo "ready=$ready"
    if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "ready=$ready" >>"$GITHUB_OUTPUT"; fi
    ;;

  upload)
    release_arg "${1:-}"; release="$1"; p="$(prefix)"
    require_configured || exit 1
    : "${R2_ACCOUNT_ID:?}" "${R2_MEDIA_WRITE_KEY_ID:?}" "${R2_MEDIA_WRITE_SECRET:?}"
    # The smoke-tested web image, by the digest `publish` handed over; `docker create` pulls it.
    [[ "${WEB_IMAGE:-}" =~ ^"$p/web"@sha256:[0-9a-f]{64}$ ]] || die "WEB_IMAGE must be $p/web@sha256:<digest> from publish, got '${WEB_IMAGE:-}'"
    log "web: uploading the static files of $WEB_IMAGE"
    registry_login
    export S3_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" S3_BUCKET="$R2_MEDIA_BUCKET"
    export S3_ACCESS_KEY_ID="$R2_MEDIA_WRITE_KEY_ID" S3_SECRET_ACCESS_KEY="$R2_MEDIA_WRITE_SECRET"
    "$assets_cmd" upload "$WEB_IMAGE" "$release"
    ;;

  push)
    release_arg "${1:-}"; p="$(prefix)"
    require_configured || exit 1
    # Every ref must be a digest `publish` handed over for the same image; check all before moving any.
    refs=()
    for t in "${targets[@]}"; do
      var="$(printf '%s' "$t" | tr '[:lower:]' '[:upper:]')_IMAGE"; r="${!var:-}"
      [[ "$r" =~ ^"$p/$t"@sha256:[0-9a-f]{64}$ ]] || die "$var must be $p/$t@sha256:<digest> from publish, got '$r'"
      refs+=("$r")
    done
    registry_login
    # A registry-side retag: the `latest` manifest is the published one, byte for byte, no pull.
    for i in "${!targets[@]}"; do
      t="${targets[$i]}"
      log "$t: latest -> ${refs[$i]}"
      docker buildx imagetools create --prefer-index=false -t "$p/$t:latest" "${refs[$i]}"
    done
    ;;

  deploy)
    release_arg "${1:-}"; release="$1"; p="$(prefix)"
    require_configured || exit 1
    : "${DEPLOY_HOST:?}" "${DEPLOY_USER:?}" "${DEPLOY_SSH_KEY:?}" "${DEPLOY_HOST_KEY:?}"
    : "${R2_ACCOUNT_ID:?}" "${R2_MEDIA_WRITE_KEY_ID:?}" "${R2_MEDIA_WRITE_SECRET:?}"
    dir="${DEPLOY_DIR:-$APP_DIR/infra}"
    tmp="$(mktemp -d "${TMPDIR:-/tmp}/ci.XXXXXX")"
    trap 'rm -rf "$tmp"' EXIT
    umask 077
    printf '%s\n' "$DEPLOY_SSH_KEY" >"$tmp/key"
    printf '%s\n' "$DEPLOY_HOST_KEY" >"$tmp/known_hosts"
    ssh=(ssh -i "$tmp/key" -o IdentitiesOnly=yes -o UserKnownHostsFile="$tmp/known_hosts"
      -o StrictHostKeyChecking=yes -o BatchMode=yes -o ConnectTimeout=20 "$DEPLOY_USER@$DEPLOY_HOST")
    # The registry login lasts as long as the CI token does; the server pulls with it right now.
    if [ -n "${GHCR_TOKEN:-}" ]; then
      printf '%s' "$GHCR_TOKEN" | "${ssh[@]}" "docker login ghcr.io -u '${GITHUB_ACTOR:-ci}' --password-stdin"
    fi
    # Each release's infra/ folder is kept as releases/<tag>/ (versioned config): deploy.sh copies
    # it to live/ only when it swaps, so a rollback brings back the matching compose and Caddy config.
    release_dir="$dir/releases/$release"
    log "copying infra/ to $DEPLOY_HOST:$release_dir"
    tar -C "$root/infra" --exclude ./test --exclude '*.test.ts' -cf - . |
      "${ssh[@]}" "mkdir -p '$release_dir' && tar -xf - -C '$release_dir' --no-same-owner"
    log "deploying $release"
    # A non-zero exit (failed, and already rolled back) fails the build: set -e stops here.
    "${ssh[@]}" "cd '$release_dir' && IMAGE_PREFIX='$p' ./deploy.sh deploy '$release'"
    # Keep the live and the previous LIVE release, from the server's history: the newest upload
    # may be a release that failed and rolled back.
    keep="$("${ssh[@]}" "cd '$release_dir' && ./deploy.sh live-releases" | paste -sd, -)"
    [[ ",$keep," == *",$release,"* ]] || die "the server does not report $release as live (got '$keep'), not pruning"
    log "deploy succeeded, pruning old static releases (keeping $keep)"
    export S3_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" S3_BUCKET="$R2_MEDIA_BUCKET"
    export S3_ACCESS_KEY_ID="$R2_MEDIA_WRITE_KEY_ID" S3_SECRET_ACCESS_KEY="$R2_MEDIA_WRITE_SECRET"
    "$assets_cmd" prune --keep "$keep"
    ;;

  *)
    die "usage: ci.sh lint-workflows | check | verify-release <tag> | build <id> | smoke <id> | publish <tag> | gate <upload|deploy> | upload <tag> | push <tag> | deploy <tag>"
    ;;
esac
