# syntax=docker/dockerfile:1
#
# One Dockerfile, three images: `--target web`, `--target cms` and `--target migrate` (ADR-0004).
# Built in CI for linux/amd64 (the VPS is x86); it also builds natively on an arm64 Mac.
# The names are the ones infra/compose.yaml runs with RELEASE unset (<project> = PROJECT_NAME in
# infra/project.env):
#   docker build --target web -t <project>/web:local .
#   docker build --target cms -t <project>/cms:local .
#   docker build --target migrate -t <project>/migrate:local .
# Workspaces are selected by folder (`--filter ./apps/web`), so renaming the @house scope needs no
# change here.

ARG NODE_VERSION=24.22.2
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1 \
    CI=true
# Keep in step with the root package.json `packageManager`.
RUN npm install -g pnpm@11.28.5 --no-fund --no-audit
WORKDIR /repo

# --- deps: install from the lockfile, cached until a manifest changes -------------------------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/cms/package.json apps/cms/package.json
COPY packages/cms-config/package.json packages/cms-config/package.json
COPY packages/motion/package.json packages/motion/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

# --- build ------------------------------------------------------------------------------------
FROM deps AS build
COPY . .
ENV NEXT_STANDALONE=1
# Both may be empty. CI sets them to the CDN prefix and the release tag (infra/assets.sh build-args).
ARG ASSET_PREFIX=""
ARG DEPLOYMENT_ID=""
ENV ASSET_PREFIX=${ASSET_PREFIX} DEPLOYMENT_ID=${DEPLOYMENT_ID}
RUN mkdir -p apps/web/public apps/cms/public
RUN pnpm --filter ./apps/web build && pnpm --filter ./apps/cms build
# libsql loads its native binding with a computed require (`@libsql/linux-<arch>-gnu`), which file
# tracing cannot see. Copy the one this build installed next to the traced packages, where Node
# resolves it from anywhere in /app. (`libsql` itself is a direct dependency of both apps so that
# it is traced at all.)
RUN for app in web cms; do \
      mkdir -p apps/$app/.next/standalone/node_modules/@libsql \
      && cp -rL node_modules/.pnpm/@libsql+linux-*/node_modules/@libsql/* apps/$app/.next/standalone/node_modules/@libsql/; \
    done

# --- runtime base: non-root, no package manager -----------------------------------------------
# Only the node binary comes from the official image: npm, corepack and yarn would add ~100 MB.
FROM debian:bookworm-slim AS runtime
COPY --from=base /usr/local/bin/node /usr/local/bin/node
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --home-dir /app --shell /usr/sbin/nologin app \
 && mkdir -p /data && chown app:app /data
WORKDIR /app

# --- web --------------------------------------------------------------------------------------
# Reads PREVIEW, DATABASE_PATH and the secrets at runtime, so one image serves `web` and
# `web-preview`.
FROM runtime AS web
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /repo/apps/web/public ./apps/web/public
USER app
ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/internal/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]

# --- cms --------------------------------------------------------------------------------------
# Standalone server only: sharp is traced in. The one-off commands (migrate, seed) live in the
# separate `migrate` image below, so this one stays small.
FROM runtime AS cms
COPY --from=build --chown=app:app /repo/apps/cms/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/cms/.next/static ./apps/cms/.next/static
COPY --from=build --chown=app:app /repo/apps/cms/public ./apps/cms/public
USER app
ENV PORT=3001
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/cms/server.js"]

# --- migrate ----------------------------------------------------------------------------------
# One-off container for `payload migrate` and the seed. Payload's CLI loads the
# TypeScript config and migrations with its bundled tsx, so this image needs the cms-config
# source plus its production dependencies, but not Next.js (which would add ~200 MB).
FROM build AS migrate-files
RUN pnpm --filter ./packages/cms-config deploy --prod --legacy /deploy
COPY infra/migrate/payload.config.ts infra/migrate/seed.ts /deploy/

FROM runtime AS migrate
COPY --from=migrate-files --chown=app:app /deploy ./
USER app
ENV PAYLOAD_CONFIG_PATH=/app/payload.config.ts
CMD ["node", "node_modules/payload/bin.js", "migrate"]
