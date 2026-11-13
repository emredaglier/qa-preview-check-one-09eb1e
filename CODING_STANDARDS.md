# Coding standards

Read during review (`/code-review` Standards axis), not while implementing. Mechanical rules live
in the linters, not here: `pnpm lint` (`scripts/check-effects.mjs`, ESLint, Prettier).

## Tests

Test behaviour where a user or caller meets it, and keep `pnpm test` near a minute.

- **Look, layout and motion** (visibility, z-order, blur, animation state) get no automated test.
  The owner checks them on web and mobile before pushing. ESLint rejects a unit test that names a
  `.css` file. The exceptions are content visibility when an effect is off (the WebGL fallback
  check) and page structure (the route sweep and accessibility checks): they read what is on the
  page, not how it looks or moves.
- **Pure maths** (layouts, easings, curves) is asserted by properties (symmetry, monotonic,
  matches a brute-force sample, clamps) plus a few worked examples. A restated constant fails on
  every deliberate retune.
- **Content visible without JS**: a page's test renders it to static markup (`renderToStaticMarkup`)
  with its data mocked and asserts the content is there. A page that needs the browser to show its
  content fails that test.
- **Slow checks** (a `next build`, Docker) run in the smoke suite against the image the gate
  already builds, not in unit tests.
- **Scripts** (`infra/*.sh`) are tested by running them against fakes on the `PATH` (`docker`,
  `ssh`, `rclone`) and a stub site, never by asserting their lines. A workflow's `run` step that
  holds logic is extracted from the parsed YAML and run the same way (`infra/media-backup.test.ts`).
- **Local sockets**: the infra suites that start a stub server (`infra/local-sockets.ts` lists them)
  are skipped with a printed notice where the machine refuses local sockets, such as an agent's
  sandbox. With `CI=true` that is an error, never a skip. A script makes temp files under
  `${TMPDIR:-/tmp}`, because macOS `mktemp` ignores `TMPDIR` without a template.
- **Repo guards** scan source or parsed config on purpose: they enforce an ADR rule that cannot be
  run without GitHub, Docker or a browser, not behaviour. A guard on a workflow or Compose file
  reads the parsed YAML, never its literal text. They are:
  - `packages/ui/src/fonts.test.ts`, `scripts/repo-guard.test.ts` (ADR-0001) and
    `apps/web/src/routes.test.ts`;
  - `infra/workflows.test.ts` (ADR-0005: delivery only from a release tag, after `check`, with
    least privilege and skipping gates; ADR-0009: the media backup only copies);
  - `infra/docs.test.ts` (ADR-0005 and ADR-0001: every secret a workflow reads, every key of
    `project.env` is documented, and no script hard-codes a server folder);
  - `infra/compose.test.ts` (ADR-0010: `migrate` and `cms` revalidate the same web instances);
  - `scripts/public-env.test.ts` (logic in `scripts/public-env.ts`; ADR-0012: no secret under `NEXT_PUBLIC_`, no server variable read
    in a client component).

## Smoke specs

The gate runs on every pull request, main and release tag (ADR-0012), so it stays small and
deterministic: every public route loads with its content and no console error or 404, redirects and
not-found pages work, and assets come from the CDN prefix. It also holds the request-level checks
that need the built image (server HTML and metadata, no admin or API routes, the revalidate secret,
no cookies, one live CMS edit reaching the cached pages) and the Satus-derived checks: axe
accessibility on every route, a secrets-in-the-bundle scan, and the WebGL DOM-fallback check on each
effect page. It runs on desktop Chromium only. Do not add specs for look, motion or interaction.

- A check's decision logic is a pure module with a unit test on broken inputs (`smoke/secrets-scan.ts`,
  `smoke/routes.ts`, `scripts/assets-budget.ts`); the browser part is proven on a deliberately
  broken page in `smoke/checks.selftest.spec.ts`. A new check gets both.
- A check never waits for a GPU or a timer: it takes WebGL away or breaks the shaders and looks at
  what is left. A spec that needs the real GPU is not a gate spec.

## Database and Payload

- `web` reads through the Local API only, passes `overrideAccess: false`, and never writes.
- Give every Payload config build its own copies of shared collection and global objects: Payload
  mutates the `fields` and `hooks` arrays it is given, and a second build in one process throws.
- A script run with `payload run` takes its flags after a `--`.
- `payload migrate:create` writes `import { MigrateUpArgs, ... }`; change the types to type-only
  imports (`type MigrateUpArgs`) or `verbatimModuleSyntax` fails the typecheck. Name the migration
  as the change, and never edit a migration that has shipped.
