# 3. SQLite (WAL) with Litestream backups

Date: 2026-11-09 · Status: accepted

## Context
A content site has one writer and light traffic. Postgres would add a service to run and tune.

## Decision
- SQLite in WAL mode with `busy_timeout` set. `cms` writes; `web` and the preview instance open
  the database read-only (`PRAGMA query_only = ON` on every connection, because libsql's local
  client opens a new connection after each transaction and does not accept `?mode=ro`).
- Litestream streams continuous backups to a private R2 bucket.
- Migrations run in a one-off container before the new release starts. They are additive (expand
  and contract), so the previous release keeps working if a rollback happens.
- Migrations are committed in `packages/cms-config/src/migrations`. `push` is for local dev only.

## Consequences
Backups and restores are a single file. All processes have to run on one host.
