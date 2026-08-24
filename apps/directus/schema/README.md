# schema/ — the data model, in version control

This folder is written by [directus-sync](https://tractr.github.io/directus-sync/). It
is generated, never hand-edited, and is the **single source of truth for the whole
data model** — `dossiers`, `editions`, roles, permissions, and both Flows.

```bash
npm run schema:dump   # live Directus  →  this folder   (after changing the model in the admin UI)
npm run schema:diff   # show what a push would change
npm run schema:load   # this folder    →  live Directus  (on a colleague's machine, in CI, on boot)
```

Both commands talk to a **running** Directus over HTTP and need credentials —
`DIRECTUS_URL` plus either `DIRECTUS_TOKEN` or `DIRECTUS_ADMIN_EMAIL`/`DIRECTUS_ADMIN_PASSWORD`
in `.env`. The container entrypoint uses the admin credentials.

```
schema/
├── snapshot/          the database structure Directus manages
│   ├── info.json      directus + vendor version the snapshot was taken with
│   ├── collections/   one file per collection (dossiers.json, editions.json, …)
│   ├── fields/        one file per field, incl. interface, options, display
│   └── relations/     one file per relation
├── collections/       the system collections directus-sync tracks, one file each
│   ├── flows.json         Flows incl. their trigger and its options (the cron string)
│   ├── operations.json    the steps inside those Flows, wired by resolve/reject
│   ├── roles.json  policies.json  permissions.json
│   ├── settings.json  presets.json  translations.json
│   └── dashboards.json  panels.json  folders.json
└── specs/             generated openapi.json + *.graphql — reference, not applied
```

**Flows are in `collections/flows.json`, not in `snapshot/`.** The snapshot is only
what Directus' own schema API covers — collections, fields, relations. Everything
else above is a row in a `directus_*` system table, which directus-sync dumps
separately and matches across environments through an id map it keeps _inside_
Directus (that is what the `directus-extension-sync` dependency is for). There is no
id-map file to commit.

`npm run schema:load` is a **diff-and-apply**, so it is safe to run repeatedly.

## The one rule

This folder owns the entire data model. `../migrations/` never creates or alters a
collection, field or relation — it exists for row data (backfills, repairs) and is a
last resort even for that. Two owners drift silently: on a fresh boot the migration
would run before the push, so `schema:load` would diff against the migration's
version of the collection instead of creating its own, and the two definitions
disagree from then on. `../migrations/` is empty in this repo, and `dossiers`/
`editions` are defined here, not there. See `apps/directus/CLAUDE.md`.
