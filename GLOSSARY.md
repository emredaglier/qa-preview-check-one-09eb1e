# House starter

The backbone every house project starts from: a public site, a private CMS, shared content
configuration, a motion toolkit and an empty UI package.

## Language

**Public site**:
`apps/web`. Renders content on the server from the CMS database, read-only, with no admin and no API routes.
_Avoid_: Frontend, website (ambiguous with the project's own site)

**CMS**:
`apps/cms`. The Payload admin. The only process that writes to the database.
_Avoid_: Backend, dashboard

**CMS config**:
`packages/cms-config`. Collections, globals, access rules, migrations and the seed, shared by both apps.
_Avoid_: Schema, models

**Starter**:
This repo, marked as a GitHub template. A project is made from it and then diverges.
_Avoid_: Boilerplate, scaffold
