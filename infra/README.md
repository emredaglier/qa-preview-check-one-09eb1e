# infra

The deploy backbone of every project made from the house starter: a hardened Docker host (ADR-0002, ADR-0004), CI-built images with health-gated deploys and automatic rollback (ADR-0005), SQLite with Litestream backups (ADR-0003), static files and media on R2 behind Cloudflare (ADR-0006, ADR-0007, ADR-0009), and the smoke gate. Cloudflare setup (DNS, R2 buckets, settings) is in [cloudflare.md](cloudflare.md). Uptime monitors are in [uptimerobot.md](uptimerobot.md).

Nothing here names a project. Every name comes from [`project.env`](project.env).

## What the owner fills in for each project

Do these once, in this order. Nothing deploys until step 5 is done: a release tag on a repo whose `project.env` still says `example.com` fails at its first step.

1. **[`infra/project.env`](project.env)** (committed, no secrets). The scripts, Compose, Caddy, CI and the smoke suite all read it; an environment variable of the same name wins over the file.

   | Key            | What                                                                                                                                        | Default          |
   | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
   | `PROJECT_NAME` | Short lowercase name: Compose project, image names (`ghcr.io/<owner>/<name>`), server folder `/opt/<name>`, R2 bucket names, Tailscale name | `house`          |
   | `DOMAIN`       | The public apex domain; `www.<DOMAIN>` redirects to it                                                                                      | `example.com`    |
   | `CDN_HOST`     | Where `/_next/static` and media are served from                                                                                             | `cdn.<DOMAIN>`   |
   | `TS_HOSTNAME`  | Tailscale machine name of the server                                                                                                        | `<PROJECT_NAME>` |
   | `TIMEZONE`     | Time zone of the weekly reboot window (Sunday 04:00), an IANA name                                                                          | `UTC`            |

   The bucket names follow from `PROJECT_NAME`: `<name>-media`, `<name>-db-backups`, `<name>-backup`. `infra/settings.ts` and `infra/project.sh` read the file; `infra/project.test.ts` checks they agree.

2. **Cloudflare and R2** ([cloudflare.md](cloudflare.md)): a zone for `DOMAIN`, an API token, then `infra/cloudflare.sh` (plan) and `infra/cloudflare.sh --apply`. Create the R2 access keys listed under "CI secrets" and the Origin CA certificate under "TLS".
3. **The server**: a small Ubuntu LTS VPS, `infra/bootstrap.sh`, `infra/tailscale-serve.sh`, the env files under "Compose" and the data directory owner. A Tailscale auth key and OAuth client are needed.
4. **GitHub**: the secrets and variables under "CI secrets"; a ruleset that lets only the project's release identity create `v*` tags; and a ruleset on `main` that requires the status checks `check` and `browser` (the job names in `ci.yml`), with "Require branches to be up to date before merging" **off** (strict off). Both jobs start on every pull request, a docs-only one included, so neither can stay pending (`infra/workflows.test.ts` guards that); if you rename a job, change the ruleset with it.
5. **Uptime monitors** ([uptimerobot.md](uptimerobot.md)) and the alert webhook (`ALERT_WEBHOOK_URL`, see "Deploy and rollback").

The first release is a tag: `git tag v0.1.0 && git push origin v0.1.0` on a commit that is already in `main`. See "CI pipeline".

## Inputs of the bootstrap

`infra/bootstrap.sh` fails fast if one of these is missing.

| Flag                  | Env           | What                                                                        |
| --------------------- | ------------- | --------------------------------------------------------------------------- |
| `--admin-user`        | `ADMIN_USER`  | Admin account to create (key-only; passwordless sudo, in the docker group)  |
| `--ssh-key`           | `SSH_KEY`     | Its public key, as a line or a path to a `.pub` file (private keys refused) |
| `--hostname`          | `TS_HOSTNAME` | Tailscale machine name (default: `TS_HOSTNAME` of `project.env`)            |
| `--ts-authkey`        | `TS_AUTHKEY`  | Tailscale auth key. Prefer the env var, flags show in `ps`                  |
| `--dry-run`           |               | Print every action, change nothing, no root needed                          |
| `--test-no-tailscale` |               | Test only: skip Tailscale, keep public 22 open                              |

```sh
sudo TS_AUTHKEY=tskey-auth-... infra/bootstrap.sh --admin-user deploy --ssh-key ~/.ssh/id_ed25519.pub
infra/tailscale-serve.sh   # after cms and web-preview are up
```

Re-running is safe. Settings live in drop-in files, so nothing edits a distro file in place. In the names below `<name>` is `PROJECT_NAME`.

## Steps (in order)

1. Upgrade packages.
2. Admin user, key in `authorized_keys`, `sudoers.d` entry.
3. ufw: deny incoming, 80/443 open, 22 **only on `tailscale0`**. Public 22 is open only while ufw is first enabled and until the last step.
4. Tailscale installed and `tailscale up` with MagicDNS (`--accept-dns`).
5. sshd drop-in `/etc/ssh/sshd_config.d/00-<name>.conf`: no passwords, no root login, `AllowUsers <admin>`, key-only. `sshd -t` before reload.
6. 2 GB swapfile (`/swapfile`, in fstab, swappiness 10).
7. Docker CE and the compose plugin from Docker's apt repo. `daemon.json`: `live-restore`, json-file log rotation (10 MB x 3).
8. `/opt/<name>/{data,env}` (`env` is mode 700).
9. journald limits (200 MB) and time sync (chrony on 26.04, systemd-timesyncd on 24.04).
10. Updates policy (below).
11. **Close public SSH**, guarded.

## The app never restarts on its own

- `unattended-upgrades` installs **security updates only**, never reboots, and blacklists `docker-ce`, `docker-ce-cli`, `containerd.io` and the Docker plugins.
- `needrestart` is list-only (`$nrconf{restart} = 'l'`): it names services that need a restart but restarts none.
- `<name>-reboot.timer` fires Sundays at 04:00 in `TIMEZONE` and runs `/usr/local/sbin/<name>-reboot-if-needed`, which reboots only if `/var/run/reboot-required` exists. After a reboot Docker brings the stack back (`restart: unless-stopped`).
- Docker package upgrades are manual: `sudo apt-get install --only-upgrade docker-ce ...` in a window you choose. `live-restore` keeps containers up through a daemon restart.

## Lockout guard and recovery

Before disabling passwords, the script checks the admin key is in `authorized_keys`. Before closing public 22 it also checks: Tailscale is `Running` with an IPv4, `sshd -t` passes, and ufw has the `22 on tailscale0` rule. If any check fails the script stops with public SSH **still open**; fix it and re-run. The recovery text is printed before anything changes.

If you are locked out:

1. Hetzner Cloud Console (or your host's), your server, **Console** (browser VNC). If no account can log in, use Rescue mode or reset the root password.
2. Log in as the admin user, then `sudo ufw allow 22/tcp`.
3. To allow passwords again: delete `/etc/ssh/sshd_config.d/00-<name>.conf`, `sudo systemctl reload ssh`.

Losing Tailscale access means losing admin access (ADR-0002). Recovery is always the host's console.

## Docker and ufw (read this)

**Published container ports bypass ufw.** Docker writes its own iptables rules ahead of ufw's, so `ports: "3001:3001"` is reachable from the internet even though ufw denies it. Therefore:

- Only Caddy publishes ports (80/443).
- Every other service binds to loopback: `127.0.0.1:3001:3001`.
- ufw is a second layer for host services (sshd), not a guard for containers.

## Tailnet serving

`infra/tailscale-serve.sh` runs `tailscale serve --bg` so the tailnet name gets HTTPS (Tailscale-issued certificates) and is only reachable by tailnet members:

| URL                                         | Loopback target                  |
| ------------------------------------------- | -------------------------------- |
| `https://<hostname>.<tailnet>.ts.net:9443/` | `127.0.0.1:3001` (`cms`)         |
| `https://<hostname>.<tailnet>.ts.net:8443/` | `127.0.0.1:3002` (`web-preview`) |

Compose publishes `cms` and `web-preview` on exactly those loopback ports; set `CMS_PORT` / `PREVIEW_PORT` when running the script if you change them. Re-running replaces the same mappings. HTTPS must be enabled in the tailnet's DNS settings (owner step).

The admin is on `9443`, not `443`, because Caddy publishes `443` and `tailscaled` starts before Docker on a reboot. If serve held `443`, Caddy could not bind it and the public site would be down (521) until recovered. `CMS_ORIGINS` must include the port. In the tailnet ACL, allow your devices to reach `tag:server` on `22`, `8443` and `9443`.

### Recovery: Caddy did not start after a reboot

Symptom: Cloudflare returns 521, `web` and `cms` are healthy, and Caddy exited with `failed to bind host port 0.0.0.0:443/tcp: address already in use`. Run on the server, in this order:

```sh
tailscale serve --https=443 off
cd /opt/<name>/infra/live && docker compose up -d --no-deps --force-recreate caddy
/opt/<name>/infra/live/tailscale-serve.sh
```

**`docker start <name>-caddy-1` does not recover this.** After the failed boot it starts the container with no networks attached: no published ports, `web` not resolvable, the site still 521. It still reports `healthy`, because the health check only asks Caddy's own admin port. Recreate the container as above.

`tailscale serve status` should then list `9443` and `8443`, and no `443`.

## SSH shortcut

The server is reachable over the tailnet only. Add this to `~/.ssh/config`:

```
Host <name>
  HostName <tailnet name or 100.x address>
  User <admin user>
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes
```

## Decision: Cloudflare-only 80/443

Not done. ufw rules do not filter Docker-published ports (above), so a ufw allowlist of Cloudflare ranges would silently do nothing for Caddy. Doing it properly means maintaining `DOCKER-USER` iptables rules and refreshing the ranges. The public site holds only public content, ADR-0002 already removed the admin and API from the public side, and Cloudflare is not trusted for anything but caching. Cheap to add later.

## Compose

`infra/compose.yaml` runs `migrate` (one-off), `caddy`, `web`, `web-preview` (same image, `PREVIEW=1`) and `cms`, plus `litestream` (below). It takes its names from `project.env`: the deploy script exports them, and on a laptop you pass `--env-file infra/project.env`. (The starter's `web` does not read `PREVIEW` yet: the preview container is wired up, and a project adds draft mode when its content model has drafts.)

| Service       | Image                            | Published               | Limit  |
| ------------- | -------------------------------- | ----------------------- | ------ |
| `caddy`       | `caddy:2.11.7-alpine`            | `80`, `443` (all hosts) | 96 MB  |
| `web`         | `$IMAGE_PREFIX/web:$RELEASE`     | none                    | 384 MB |
| `web-preview` | same as `web`                    | `127.0.0.1:3002`        | 384 MB |
| `cms`         | `$IMAGE_PREFIX/cms:$RELEASE`     | `127.0.0.1:3001`        | 512 MB |
| `migrate`     | `$IMAGE_PREFIX/migrate:$RELEASE` | none (exits)            | 384 MB |

Limits (Litestream adds 128 MB) stay well under a 4 GB host with 2 GB swap. Node heaps are capped through `NODE_OPTIONS` below the container limit.

**Variables** (all optional except where noted): `PROJECT_NAME` and `DOMAIN` (from `project.env`, required), `RELEASE` (image tag, default `local`; always set it on the server), `IMAGE_PREFIX` (default `<name>`), `DATA_DIR` (`/opt/<name>/data`), `ENV_DIR` (`/opt/<name>/env`), `CERTS_DIR` (`/opt/<name>/certs`).

**Env files** in `ENV_DIR`, mode 600, never in the repo:

- `cms.env`: `PAYLOAD_SECRET` (signs admin sessions), `REVALIDATE_SECRET`, `CMS_ORIGINS` (**required**: the tailnet HTTPS URL of cms, `https://<host>.<tailnet>.ts.net:9443`; cms and migrate refuse to start without it, because an empty list turns Payload's CSRF check off). A project with media adds `MEDIA_ORIGIN` (`https://<CDN_HOST>`) and the `S3_*` credentials.
- `web.env`: `PAYLOAD_SECRET` (**its own random value, different from cms**: the shared config requires one, but web never signs anything, and the public container must not hold the key that signs admin sessions), `REVALIDATE_SECRET` (same value as cms). Used by `web` and `web-preview`.
- `litestream.env`: see "Backups: Litestream".

Compose sets `DATABASE_PATH=/data/site.db`, `PREVIEW` and `REVALIDATE_URLS` itself.

**Data directory.** `DATA_DIR` is bind-mounted at `/data` in every service, and the app user in the images is uid/gid `10001`. Before the first start: `sudo chown 10001:10001 /opt/<name>/data` (bootstrap creates the directory, not the owner). `web` opens the file read-only at connection level (`PRAGMA query_only`), but the directory stays writable because WAL readers need `-shm`.

**Start-up order.** `migrate` runs `payload migrate` and must exit 0 before `web`, `web-preview` and `cms` start; `caddy` waits for `web` to be healthy. Migrations are additive (ADR-0003). Run them alone with `docker compose run --rm migrate`. Seed: `docker compose run --rm migrate node node_modules/payload/bin.js run seed.ts [--force]`. The seed saves through the same revalidate hooks as the admin, and Compose gives `migrate` the same `REVALIDATE_URLS` as `cms`, so a seed (or re-seed) against a running stack refreshes `web` and `web-preview` without a restart. Migrations don't use the hooks. If `web` is down (first seed, mid-deploy), the post fails after at most 2 s, is logged, and the seed still completes and keeps its writes. A `web` that was down keeps whatever cache it had: post the tags to `/internal/revalidate` or recreate the container (a restart keeps the cache).

**Images.** One root `Dockerfile`, targets `web`, `cms`, `migrate`. Build (CI does this for `linux/amd64`; an arm64 Mac builds natively):

```sh
docker build --target web     -t <name>/web:local .
docker build --target cms     -t <name>/cms:local .
docker build --target migrate -t <name>/migrate:local .
# production: add --platform linux/amd64 and the build args from `infra/assets.sh build-args <release>`
```

`web` and `cms` are Next standalone output (monorepo root as tracing root), run as uid 10001 on `debian:bookworm-slim` with only the `node` binary copied in (no npm). Health: `web` `/internal/health` and `cms` `/health` open the database and read it; both images declare a `HEALTHCHECK`. A native package that the server bundle needs (libsql is one) must be a direct dependency of the app that runs, and a computed-require binding is copied in by the Dockerfile. `migrate` is separate from `cms` on purpose: Payload's CLI needs the full Payload dependency tree plus `tsx` and the TypeScript migration source, and bringing that into `cms` would add about 175 MB to the long-running image. The Dockerfile selects workspaces by folder (`--filter ./apps/web`), so renaming the `@house` scope needs no change there.

**Caddy** (`infra/caddy/`): `{$DOMAIN}` serves `web`; `www.{$DOMAIN}` redirects (301) to it; `/internal/*` and `/preview/*` return 404 publicly (cms reaches `/internal/revalidate` over the Docker network, `web:3000`); Cloudflare's ranges are trusted for the client IP (`CF-Connecting-IP`); no rate limiting. Compose passes `DOMAIN` to the container. The range list is static in `Caddyfile`; refresh it from <https://www.cloudflare.com/ips/> if Cloudflare changes it.

### Run it on a laptop

```sh
# build the three :local images first (above), then:
docker compose --env-file infra/project.env -f infra/compose.yaml -f infra/compose.local.yaml up --wait
```

The override uses the `:local` images, a Docker-managed volume, dummy secrets, and plain HTTP: the site is at <http://127.0.0.1:8080>, `cms` at <http://127.0.0.1:3001/admin>, `web-preview` at <http://127.0.0.1:3002>. `docker compose ... down -v` also deletes the data volume.

## Backups: Litestream

The `litestream` service (`litestream/litestream:0.5.17`, 128 MB, `restart: unless-stopped`, read-only root filesystem, uid 10001) mounts the same data volume and streams `/data/site.db` to the private R2 bucket `<name>-db-backups` (ADR-0003). Config: `infra/litestream/litestream.yml`.

- **Loss window:** WAL segments are shipped every 5 s. A crash loses at most a few seconds of edits.
- **Snapshots and retention:** a full snapshot every 6 h, kept 7 days. Restore time is one snapshot plus at most 6 h of segments. Litestream deletes what falls outside retention, so its R2 key needs Object Read & Write on `<name>-db-backups` (bucket created by `cloudflare.sh`, no lock on it).
- **Checkpointing:** Litestream owns WAL checkpoints, so nothing else may run `wal_checkpoint(TRUNCATE|RESTART)` or disable auto-checkpoint (the apps do neither). `busy_timeout` lets `cms` wait out Litestream's short locks. `cms` is the only writer; `web` stays read-only; all share one volume because the `-shm` file must be shared.
- **Health:** `litestream status` must report `ok` (initialised and replicating). A failing bucket or key shows up as unhealthy within about a minute: `docker compose ps`, `docker compose logs litestream`.
- **Settings:** `$ENV_DIR/litestream.env` (mode 600): `LITESTREAM_BUCKET=<name>-db-backups`, `LITESTREAM_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, `LITESTREAM_REGION=auto`, `LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY`. Use a key scoped to that one bucket. Without the file `docker compose up` refuses to start.
- **Locally** the override adds an `s3mock` stand-in (bucket `<name>-db-backups`) and points `litestream` at it. Nothing local talks to R2.

**Drill (scripted):** `infra/litestream/drill.sh` starts `cms`, `litestream` and the stand-in under a throwaway project name (random ports), registers a user and saves the Site global through the cms API, forces a sync, restores into an empty directory and compares the content, edits again while replication runs, restores into another empty directory and checks the edit is there, then tears everything down. Needs the `:local` images, Docker, `curl`, `sqlite3`.

**Restore runbook** (server lost or database damaged):

1. Stop the writers: `docker compose stop cms web web-preview litestream`.
2. Keep the damaged data aside: `sudo mv /opt/<name>/data /opt/<name>/data.broken`, then `sudo install -d -o 10001 -g 10001 /opt/<name>/data`. On a fresh server run bootstrap first (it creates `/opt/<name>/{data,env}`), put `litestream.env` back in `/opt/<name>/env`, and the `chown` above.
3. Restore: `infra/litestream/restore.sh -f infra/compose.yaml -- /opt/<name>/data` (the directory must be empty). For a point in time add `-timestamp 2026-11-01T10:00:00Z` (or `-txid <hex>`; `docker compose run --rm --no-deps litestream ltx -config /etc/litestream/litestream.yml /data/site.db` lists what exists). The script chowns the result to 10001.
4. Check: `sqlite3 /opt/<name>/data/site.db 'PRAGMA integrity_check; SELECT count(*) FROM users;'` (needs `sudo`).
5. Start: `docker compose up -d --wait`. Litestream resumes on the restored file and starts a new generation; `migrate` runs first and is a no-op if the schema is current.
6. Media are not in the database: they live in R2 (`<name>-media`, with the nightly `<name>-backup` copy).

**Deploy hook:** `infra/litestream/snapshot.sh -f infra/compose.yaml` forces a sync and waits until the bucket is current. The deploy calls it right before migrations; if it fails, nothing migrates. The deploy log prints the restore point: a bad migration is undone by restoring with `-timestamp` set to just before it.

## Smoke gate (pre-release)

`pnpm smoke` (`smoke/run.ts`) migrates and seeds a temp database, builds the `web` image (or uses `SMOKE_WEB_IMAGE`), runs it against that database and drives the public routes in headless desktop Chromium. It fails on any console error, page error, failed request or 404 subresource, and checks the request-level rules that need the built image: server HTML, no `/admin` or `/api` routes, the revalidate secret, no cookies, assets from the CDN prefix with the deployment id, and one CMS edit reaching the cached home page through the revalidate hook. This is CI's gate on every pull request and every release (ADR-0005, ADR-0012); `infra/smoke.sh` is the separate post-deploy check against the live site. Keep the gate small (CODING_STANDARDS.md, "Smoke specs").

The Satus-derived checks (adapted from darkroom's Satus, MIT; `THIRD-PARTY-NOTICES.md`) are specs of the same run:

| Check                 | Where                                                      | What fails it                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route sweep           | `smoke/smoke.spec.ts`, `smoke/routes.ts`, `smoke/sweep.ts` | A page under `apps/web/src/app` that does not answer 200, or logs a console error, or lacks the page structure (a `lang`, a title, one `main`, one visible `h1`: `smoke/structure.ts`, shared with the accessibility check). Pages are found from the folder; a dynamic page needs a sample URL in `smoke/routes.ts`                                                                                           |
| Accessibility         | `smoke/a11y.spec.ts`, `smoke/a11y.ts`                      | An axe critical or serious violation, or a page without the structure of `smoke/structure.ts`, on every route and the 404 page                                                                                                                                                                                                                                                                                 |
| Secrets in the bundle | `smoke/secrets.spec.ts`, `smoke/secrets-scan.ts`           | A server secret's value, or credential-shaped text, in a page, its flight data, any script or stylesheet reachable from it, or any script or stylesheet in the image's `.next/static` (`run.ts` lists them with `docker cp`, so lazily loaded chunks are read too). `scripts/public-env.ts` (tested and run over the repo in `scripts/public-env.test.ts`) guards the build-time half (`NEXT_PUBLIC_` secrets) |
| Asset weight          | `pnpm check:assets` (`scripts/assets-budget.ts`)           | A tracked image over 1 MB or 2400 px wide, a video over 2 MB, an icon over 48 KB or 512 px, or an image whose width cannot be read. The budget is in `scripts/assets-budget.ts`                                                                                                                                                                                                                                |
| WebGL DOM fallback    | `smoke/webgl-fallback.spec.ts`, `smoke/webgl.ts`           | An effect page that, with no WebGL or with shaders that fail, hides its text, leaves its canvas, logs an error, or (shader failure) reports no `gl-error` fault. A project lists its effect pages in `EFFECT_PAGES`                                                                                                                                                                                            |

`smoke/checks.selftest.spec.ts` runs each of these against a deliberately broken page, so a check that has gone blind fails. A release tag leaves it out (`ci.sh smoke` passes `--grep-invert "check self-test"`): it ran on the pull request and on `main`. The secrets crawl is proven by unit tests (`smoke/secrets-scan.test.ts`, with a fake site). To see the secrets check fail on the template, name a string the pages serve: `SMOKE_EXTRA_SECRETS='["Glow example"]' pnpm smoke -g "no server secret"`.

```sh
pnpm install && pnpm exec playwright install chromium   # once
pnpm smoke                                              # builds the image itself (needs Docker)
# against an image that is already built, with the prefix it was built with:
docker build --target web --build-arg ASSET_PREFIX=https://<CDN_HOST> --build-arg DEPLOYMENT_ID=smoke -t <name>-web:smoke .
SMOKE_WEB_IMAGE=<name>-web:smoke SMOKE_ASSET_PREFIX=https://<CDN_HOST> pnpm smoke
```

The header of `smoke/run.ts` lists the environment variables (`SMOKE_PLATFORM`, `SMOKE_PORT`, `SMOKE_KEEP`, `SMOKE_OUTPUT_DIR`, `SMOKE_RUNNER`, `SMOKE_EXTRA_SECRETS`) and `pnpm smoke -g <text>` runs one spec. The browser asks the CDN prefix for `/_next/` files; `smoke/network.ts` answers those from the container, so nothing leaves the machine and nothing needs to be on the CDN yet. A new public page is picked up from `apps/web/src/app`; a dynamic page gets a sample URL in `DYNAMIC_ROUTE_SAMPLES` (`smoke/routes.ts`), or the unit tests fail.

A gate that cannot fail proves nothing: after changing it, plant a fault (a `console.error` in the root layout, a broken asset URL), watch it go red, and revert.

## TLS

**Decision: Cloudflare Origin CA certificate, Cloudflare SSL mode Full (strict).** ACME can fail behind the Cloudflare proxy (HTTP-01 and TLS-ALPN-01 challenges get terminated at the edge), and a renewal failure would take the site down 60 to 90 days after launch. An Origin CA certificate is valid for up to 15 years, is trusted by Cloudflare only (a browser would not trust it, so the origin is not usable directly, which is fine), and needs no renewal job. Cost: if the site ever leaves Cloudflare, the certificate has to be replaced. Cheap to reverse: swap the two `tls` lines for Caddy's automatic HTTPS.

Owner steps:

1. Cloudflare dashboard, SSL/TLS, Origin Server, create a certificate for `<DOMAIN>` and `*.<DOMAIN>`.
2. Save the certificate as `/opt/<name>/certs/origin.pem` and the key as `/opt/<name>/certs/origin.key` (mode 600; Caddy runs as root in its container and can read them).
3. Set SSL/TLS mode to Full (strict). `infra/cloudflare.sh` also sets it.

## Static assets on the CDN

Each release's `/_next/static` lives at `https://<CDN_HOST>/releases/<tag>/_next/static/` (media bucket, immutable headers). A tab opened before a deploy keeps loading its own release's chunks; Next's `deploymentId` (the release tag, sent as `?dpl=` and an `x-deployment-id` header) makes the stale tab do a full reload on its next navigation instead of mixing versions. With `ASSET_PREFIX` empty the app serves `/_next/static` itself (laptop, the smoke gate without a prefix). **A release tag is never reused**: the CDN folder and the images are named by it and cached as immutable.

```sh
tag=v1.2.3
docker build --target web $(infra/assets.sh build-args "$tag") -t <name>/web:$tag .
infra/assets.sh upload <name>/web:$tag "$tag"   # BEFORE the containers start; only ever PUTs
infra/assets.sh prune --keep "$(infra/deploy.sh live-releases | paste -sd, -)"   # after a healthy deploy
```

Both scripts need `S3_ENDPOINT`, `S3_BUCKET` (the media bucket), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (prune needs delete) and Node 24. `upload` extracts `/app/apps/web/.next/static` from the image with `docker create` and `docker cp`. Prune deletes releases whose newest object is over 30 days old, except the ones passed with `--keep` whatever their age (R2 has no lifecycle rule for this because it would expire a live release after 30 quiet days). `--keep` is required and must be the live and the previous **live** release from the server's history (`deploy.sh live-releases`), never guessed from upload times: a newer upload may be a release that failed and rolled back. `--dry-run` lists without deleting. Tests: `infra/release-assets.test.ts`, `infra/assets.test.ts` (in-process S3 stub, `infra/s3-stub.ts`).

## Deploy and rollback

`infra/deploy.sh` (ADR-0005) runs on the server. The admin user runs it (docker group). CI runs it from a release tag; a laptop never deploys.

**Versioned config.** Each release's `infra/` folder (compose file, Caddy and Litestream config, scripts, `project.env`) is kept on the server as `/opt/<name>/infra/releases/<tag>/`; CI copies it there and runs that copy's `deploy.sh`. The long-running services always run from `/opt/<name>/infra/live/`, a copy of the live release's folder: every swap first copies the target release's folder there, so an automatic or manual rollback also brings back that release's compose file and Caddy/Litestream config. Caddy and Litestream mount their config **directories** (`live/caddy`, `live/litestream`), because a single-file bind mount keeps pointing at the replaced file's old inode; when that config changed, the swap reloads Caddy (`caddy reload`, recreated if the reload fails) and recreates Litestream. Config folders of releases no longer in the history are removed after a good deploy. Run the day-to-day commands from `live/`:

```sh
cd /opt/<name>/infra/live
./deploy.sh rollback       # back one release, no migrations; run again to go back further
./deploy.sh status         # release history, last line = live
./deploy.sh live-releases  # previous live and live release (what static-asset prune keeps)
# deploy (CI does this): /opt/<name>/infra/releases/<tag>/deploy.sh deploy <tag>
```

**A manual deploy can't pull.** The images on GHCR are private, and the server keeps no registry login of its own: CI logs it in with the job's token just before each deploy, and that token expires when the job ends. So a manual `deploy` fails at the pull with `error from registry: denied` (nothing changes). Rollback never pulls, so drill the roll-forward too, not only the rollback. To deploy a release by hand:

- Its images are still on the server (it was live recently; check with `docker image ls | grep <tag>`): `DEPLOY_PULL=0 /opt/<name>/infra/releases/<tag>/deploy.sh deploy <tag>`.
- They aren't: re-run that tag's CI run (`gh run rerun <run id>`), which logs the server in and deploys.

Outside that layout (laptop, the drill) `deploy.sh` runs everything from its own folder, unversioned. Other `docker compose` commands on the server (seed, restore) also run from `live/`.

**Deploy steps.** Each step before the swap stops the deploy on failure, alerts, exits 1, and leaves the running containers untouched.

1. Lock (`/opt/<name>/state/deploy.lock`; a lock whose pid is gone is taken over).
2. Record the live tag (last line of `/opt/<name>/state/releases`, else the running `web` image's tag), then `docker compose pull` the new `migrate`, `web` and `cms`.
3. With `DEPLOY_ASSETS=1` only: `infra/assets.sh upload` the release's static files (see above). Off by default because CI uploads them and the server has no Node.
4. `infra/litestream/snapshot.sh` (off-site replica current; skipped with a notice while Litestream is not running yet, i.e. the very first deploy). The log prints the restore point. Then a local **pre-migration copy** with `VACUUM INTO` (in the new `migrate` image, Node's built-in SQLite) to `/opt/<name>/data/pre-migrate/<UTC time>-<from>-to-<to>.db`, integrity-checked; the newest 5 are kept (`KEEP_SNAPSHOTS`).
5. `docker compose run --rm migrate` with the new tag. **A failing migration stops here.**
6. Swap: copy the release's config to `live/`, `docker compose up -d --wait --no-deps` (from `live/`) every service except `migrate` on the new tag, reload Caddy / recreate Litestream if their config changed, then the smoke checks (`infra/smoke.sh`): home, one static chunk parsed from the home HTML, one content page from `/sitemap.xml`, the first image on it. The page and image are skipped with a NOTICE while the site has no sitemap page or no image. The checks go to this server's Caddy (`https://<DOMAIN>` resolved to 127.0.0.1, certificate not verified: it is an Origin CA one), not through Cloudflare; the static chunk and the image are fetched from wherever the HTML points (the CDN in production).
7. Healthy: the tag is appended to the history (and, with `DEPLOY_ASSETS=1`, old static releases are pruned, keeping `live-releases`). Not healthy: swap back to the previous tag, wait for health, re-check, alert, exit 1, so CI goes red. With no previous tag (first deploy) it only alerts.

The swap recreates the containers, so the site is down for the few seconds `web` takes to start (no blue-green on one small host).

**Alerts.** Every failure POSTs to `ALERT_WEBHOOK_URL`. `ALERT_WEBHOOK_FORMAT=json` (default) sends `{"text": ..., "content": ...}`, which Slack and Discord webhooks and Telegram (`https://api.telegram.org/bot<token>/sendMessage?chat_id=<id>`) accept; `text` sends a plain body for ntfy (`https://ntfy.sh/<topic>`). Without a URL the alert is printed in a loud banner only. The owner picks the channel.

**Settings** in `/opt/<name>/env/deploy.env` (optional, mode 600, sourced by the script): `ALERT_WEBHOOK_URL`, `ALERT_WEBHOOK_FORMAT`, `IMAGE_PREFIX` (e.g. `ghcr.io/<owner>/<name>`). Rarely needed: `SMOKE_URL`, `SMOKE_RESOLVE`, `SMOKE_INSECURE`, `KEEP_SNAPSHOTS`, `WAIT_TIMEOUT` (180 s), `STATE_DIR`, `DEPLOY_ASSETS`, `DEPLOY_PULL=0` (local images). See the header of `deploy.sh`.

**First deploy on a fresh server.** Home renders on an empty database (an empty Site global gives an empty page), but the site has no content until it is seeded. Seed first: `RELEASE=<tag> docker compose run --rm migrate`, then the seed command (Compose, above), then `infra/deploy.sh deploy <tag>`.

**Rollback and the schema.** Migrations are additive (expand and contract, ADR-0003), so an older release runs on a newer schema and neither rollback reverts it. A tag that has been rolled back from is still in the registry; deploying it again runs its migrations again (a no-op).

**Restore from the pre-migration copy** (rare: a migration that damaged data, not just added columns). Prefer the Litestream restore to the printed restore point (runbook above) because it is off-site and exact; the local copy is the fallback when the replica is unavailable.

1. `docker compose stop cms web web-preview litestream`.
2. `cd /opt/<name>/data && sudo mkdir -p broken && sudo mv site.db site.db-wal site.db-shm broken/ 2>/dev/null; sudo cp pre-migrate/<copy>.db site.db && sudo chown 10001:10001 site.db`.
3. Deploy the previous release's code without its migrations: `RELEASE=<previous tag> docker compose up -d --wait --no-deps cms web web-preview litestream caddy` (not `deploy.sh`, which would run the bad migration again). Fix the migration in a new release.
4. Litestream starts a new generation on the replaced file. Edits made between the copy and the restore are lost.

**Drill:** `infra/test/deploy-drill.sh` (needs Docker and the `:local` images; own project `<name>-drill`, ports 18080/13001/13002, removed at the end). It seeds, deploys two good tags, then a `web` build without its static files and one that never gets healthy (both roll back by themselves and call a stub webhook), a failing migration (the `web` container keeps its id and start time), checks the copies are pruned, and runs the manual rollback. Unit tests: `infra/deploy.test.ts` (fake `docker`), `infra/smoke.test.ts` (stub site).

## Media: restore and backup

The starter has no media collection yet (ADR-0009): the first project with uploads adds it, with the soft delete below. The buckets, the lifecycle rule, the bucket lock and the nightly backup are in place from the start.

Deleting a file in the `cms` admin removes the record and moves the original and every size to `trash/<key>` in the `<name>-media` bucket. A 30-day lifecycle rule (set by `cloudflare.sh`) then removes them. The 30 days count from the move.

**Restore a deleted file** (by hand). The Media record is gone for good, so copying the objects back out of `trash/` restores nothing the site can show: no record points at them. Instead **re-upload the original as a new Media record**:

1. Get the original. Within 30 days: Cloudflare dashboard, R2, `<name>-media`, under `trash/`. Download it from the dashboard, or with `rclone copyto` / `aws s3 cp --endpoint-url https://<account>.r2.cloudflarestorage.com` and a read key. After 30 days, take it from the `<name>-backup` bucket (below) instead, same name without `trash/`.
2. In the `cms` admin, Media, create a new record from that file and fill in the alt text again. It gets a new unique key and all sizes are generated afresh.
3. Set the file again everywhere the old one was used (the old references were removed with the record).

Never copy objects back to their old keys: nothing reads them, and keys are never reused.

**Nightly backup.** `.github/workflows/media-backup.yml` runs at 01:17 UTC and `rclone copy`s `<name>-media` to `<name>-backup` (the names are read from `project.env`). It only copies, skips `_next/` (static releases) and `trash/`, and never uses sync or delete flags (a test enforces it). Then `rclone check --one-way` fails the run if any object listed just before the copy is missing from the backup, and a copy that only succeeded on a retry leaves a warning in the run summary. rclone is a pinned release with its checksum in the workflow; to update it, change `PINNED_RCLONE_VERSION` and `PINNED_RCLONE_SHA256` (from the release's `SHA256SUMS`). rclone reads every `RCLONE_*` environment variable as a flag, so never name a variable `RCLONE_VERSION`. The VPS does no work. `<name>-backup` has an indefinite bucket lock, so even a leaked key cannot delete from it. Deleted files stay in the backup forever, unless they are removed on request (below); to restore from it, copy the objects back to `<name>-media` the same way. Run it by hand from the Actions tab (`workflow_dispatch`). It skips cleanly while the secrets below are missing.

**Remove a file on request** (for example a privacy request: an answer within the legal deadline and, if the request is justified, the files, cached copies and backup copy deleted). A file is several objects, one per size, whose names all start with the same name and random suffix. Do the steps in this order, because the nightly copy would otherwise copy a file that is still in `<name>-media`:

1. **Check you can restore the lock first.** Set the three `CLOUDFLARE_*` variables and run `infra/cloudflare.sh`: it must print `0 change(s) planned`. If the token has expired or been revoked, make a new one ([cloudflare.md](cloudflare.md), "Token"). Step 5 needs it, and without it the backup stays unprotected.
2. If the person asked for a change rather than a removal, upload the edited file as a new Media record and use it where the old one was (steps 2 and 3 of the restore above).
3. In the `cms` admin, delete the old Media record. In Cloudflare, R2, `<name>-media`, delete its objects under `trash/` now, rather than waiting 30 days. Check that nothing is left at the old keys either: the move can fail, which the `cms` log shows as `Could not move ...`, and it leaves the live file in place. Delete any you find.
4. Cloudflare dashboard, your domain, Caching, Configuration, Custom Purge: purge the `https://<CDN_HOST>/...` URL of each object. They are cached as immutable, so otherwise the edge can keep serving them.
5. Cloudflare dashboard, R2, `<name>-backup`, Settings: delete the bucket lock rule, delete the objects, then put the rule back with `infra/cloudflare.sh --apply`. Run `infra/cloudflare.sh` again: it must print `0 change(s) planned`. With the lock rule removed, the dashboard deletes objects the rule had protected.

The database still holds traces for a while, namely the record's alt text and filename. Litestream's snapshots age out after 7 days (`litestream.yml`). The `pre-migrate/` copies on the server have no age limit: a deploy keeps the newest 5 (`deploy.sh`), so if the alt text or filename names the person, delete those copies by hand too.

## CI secrets

The workflows read these repository secrets and variables (Settings, Secrets and variables, Actions). **Until they exist the steps that need them skip with a notice and the run stays green**, see "CI pipeline". `infra/docs.test.ts` fails if a workflow reads a name that is not listed here.

| Secret                   | Used by          | What                                                                                                                                                           |
| ------------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `R2_ACCOUNT_ID`          | backup, CI       | Cloudflare account id                                                                                                                                          |
| `R2_MEDIA_READ_KEY_ID`   | media backup     | R2 access key, **Object Read only**, scoped to `<name>-media`                                                                                                  |
| `R2_MEDIA_READ_SECRET`   | media backup     | its secret                                                                                                                                                     |
| `R2_BACKUP_WRITE_KEY_ID` | media backup     | R2 access key, Object Read & Write, scoped to `<name>-backup` only (R2 has no write-only scope; the bucket lock stops deletes)                                 |
| `R2_BACKUP_WRITE_SECRET` | media backup     | its secret                                                                                                                                                     |
| `R2_MEDIA_WRITE_KEY_ID`  | CI upload, prune | R2 access key, Object Read & Write, scoped to `<name>-media` (uploads the static release, prunes old ones; the CMS key works too, but keep its own)            |
| `R2_MEDIA_WRITE_SECRET`  | CI upload, prune | its secret                                                                                                                                                     |
| `TS_OAUTH_CLIENT_ID`     | CI deploy        | Tailscale OAuth client (Settings, OAuth clients) with scope `auth_keys` write, tag `tag:ci`; the tailnet policy must let `tag:ci` reach the server on port 22  |
| `TS_OAUTH_SECRET`        | CI deploy        | its secret                                                                                                                                                     |
| `DEPLOY_SSH_KEY`         | CI deploy        | private key of a dedicated deploy key pair; the public half goes in the admin user's `authorized_keys` on the server (`ssh-keygen -t ed25519 -f deploy -N ''`) |
| `DEPLOY_HOST_KEY`        | CI deploy        | the server's host key line, pinned so the connection is verified: `ssh-keyscan -t ed25519 <tailnet-name>` run from a machine on the tailnet                    |

| Variable      | Used by   | What                                                             |
| ------------- | --------- | ---------------------------------------------------------------- |
| `DEPLOY_HOST` | CI deploy | the server's tailnet name or `100.x` address                     |
| `DEPLOY_USER` | CI deploy | the admin user from the bootstrap (member of the `docker` group) |

`GITHUB_TOKEN` is automatic (no secret to create): the `build` and `push` jobs have `packages: write`, the `upload` and `deploy` jobs `packages: read`; `deploy` logs the server in to GHCR with it for that one deploy, so the images can stay private and no long-lived registry token exists. The image prefix is `ghcr.io/<owner>/<name>` (owner lowercased); the same value is `IMAGE_PREFIX` in `/opt/<name>/env/deploy.env`, which the deploy step also sets explicitly.

## CI pipeline

`.github/workflows/ci.yml` only orchestrates; every step is a command of `infra/ci.sh` (header lists them), so you can run any of them on a laptop.

**Images are built, published and deployed from a release tag only** (`v1.2.3`, `v1.2.3-rc.1`). HQ cuts the tag after the owner's launch approval, and the repository restricts who may create `v*` tags. Pull requests and pushes to `main` run `check` and `browser` and publish nothing. A pull request always runs both, because both are required checks on `main` (see "Setup"); a push to `main` that only changes `docs/` or `.scratch/` starts no run. The tag is the release name: it names the images, the CDN folder `releases/<tag>` and the deploy, so a tag is never reused.

| Job       | Runs on         | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check`   | PR, `main`, tag | On a tag first `ci.sh verify-release <tag>`: the tagged commit must already be in `origin/main`, and `project.env` must not be the template placeholder. Then `ci.sh check`: actionlint on the workflows, `pnpm lint`, `pnpm check:assets` (the asset-weight budget), `typecheck`, `test`                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `browser` | PR, `main`      | `ci.sh build <sha>` with `CI_TARGETS=web` (only the `web` image, for this commit, never pushed), then `ci.sh smoke <sha>`: the smoke gate and browser checks a tag runs in `build`, plus their self-tests (ADR-0012). No secrets, no registry or deploy permission; `smoke/.output` is uploaded on failure. Its Playwright downloads have their own timeouts. The buildx layer cache is restored on a pull request and saved only on a push to `main`                                                                                                                                                                                                                                                                                                |
| `build`   | tag             | needs `check`, so no image reaches GHCR from a tag that failed it. `ci.sh build <tag>`: `web`, `cms`, `migrate` for `linux/amd64` with a local buildx cache (`actions/cache`); `web` gets the CDN prefix and the tag (`assets.sh build-args`). Prints each image size and **warns** above 300 MB. Then `ci.sh smoke <tag>` on the same runner: the release gate against the built `web` image, without `smoke/checks.selftest.spec.ts` (those ran on the pull request and on `main`); `smoke/.output` is uploaded on failure. After it passes, `ci.sh publish <tag>` pushes the `<tag>` images to GHCR and outputs each pushed digest. Later jobs use those digests, never the tags and never an artifact, so the tested bytes are the shipped bytes |
| `upload`  | tag             | `ci.sh upload <tag>` (needs `check` and `build`): the `web` digest's `/_next/static` to `<name>-media` under `releases/<tag>/` (never deletes); logs in to GHCR and pulls that digest                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `push`    | tag             | `ci.sh push <tag>` (needs `build` and `upload`): moves the `latest` tags to exactly the published digests, registry-side (`docker buildx imagetools create`), no pull. Refuses a ref that is not a digest of the right image                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `deploy`  | tag             | joins the tailnet, `ci.sh deploy <tag>`: copies `infra/` to `/opt/<name>/infra/releases/<tag>`, runs `deploy.sh deploy <tag>` there (non-zero exit = red build), then `assets.sh prune --keep <deploy.sh live-releases>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

**Skipping.** `upload` skips when the three `R2_MEDIA_WRITE_*`/`R2_ACCOUNT_ID` secrets are not all set; `deploy` skips unless those **and** the Tailscale and `DEPLOY_*` ones are set (a deploy without uploaded assets would serve a page whose scripts 404). `ci.sh gate <upload|deploy>` makes the decision and prints which names are missing. `build` (publish) and `push` need no secret: they always run on a tag.

**Concurrency.** A newer push to a pull request cancels the older run. A release is never cancelled, and the `deploy` job (group `deploy`) never runs twice at once: a newer one waits.

**Local runs.** `infra/ci.sh check`; `CI_PLATFORM=linux/arm64 IMAGE_PREFIX=<name>-ci infra/ci.sh build $(git rev-parse --short HEAD)` then `IMAGE_PREFIX=<name>-ci infra/ci.sh smoke <same>` on an Apple Silicon laptop (the `amd64` default is emulated and slow). Image sizes: `docker image ls` on the runner is the number to read; Docker Desktop's containerd store prints a larger one than overlay2.

**Server prerequisites.** `/opt/<name>/infra` (with `releases/` and `live/`) is created by the first deploy (owned by the admin user). `/opt/<name>/env/deploy.env` should have `IMAGE_PREFIX` (and the alert webhook). The `litestream.env`, `cms.env`, `web.env` files and a seeded database must exist before the first deploy (see "First deploy on a fresh server").

**Pinning.** Third-party actions are pinned to major versions (`actions/*`, `pnpm/action-setup`, `docker/setup-buildx-action`, `tailscale/github-action`). Pin to commit SHAs (Dependabot can do it) before the deploy path is treated as hardened.

## Testing

Unit tests run without Cloudflare, R2 or server credentials, and without Docker: `infra/cloudflare.test.ts` runs the script against a local mock of the Cloudflare API (`infra/cloudflare-mock.ts`), `assets` and `release-assets` against an in-process S3 stub (`infra/s3-stub.ts`), `deploy.test.ts` and `ci.test.ts` against a fake `docker` on the `PATH`, `smoke.test.ts` against a stub site (`infra/site-stub.ts`), `media-backup.test.ts` runs the backup step of the workflow against a fake `rclone`. `workflows.test.ts`, `docs.test.ts` and `compose.test.ts` are repo guards: they read the parsed workflow and Compose files for the ADR rules that need GitHub or Docker to run (CODING_STANDARDS.md). Only one test builds a tiny image when a Docker daemon is up (`assets.test.ts`).

`infra/test/run.sh [ubuntu-version]` builds a systemd Ubuntu container (`infra/test/Dockerfile`), runs the bootstrap twice with `--test-no-tailscale`, then `verify.sh` (sshd, ufw, swap, Docker, update config, timer) and `guard-test.sh` (inputs, lockout guard). Needs Docker and `--privileged`. Shellcheck: `shellcheck -x infra/*.sh infra/test/*.sh infra/litestream/*.sh`.

A container is not a VM. Not covered: real `tailscale up` and `tailscale serve`, swap activation (`swapon` is refused in a container), a reboot (prove boot behaviour with a real reboot of the first server), a real SSH login with the hardened config, and the host's own image.
