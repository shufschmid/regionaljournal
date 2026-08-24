# apps/directus — Backend

Directus 11 on Postgres 16. This app owns the data model **and all server-side
logic**. There is no separate API service: business logic ships as a Directus
extension bundle running inside the Directus process.

Read the root [CLAUDE.md](../../CLAUDE.md) first — the hard constraints there apply
here.

## Layout

```
apps/directus/
├── extensions/app/          ← ALL server-side logic (one bundle, own package.json)
│   └── src/
│       ├── shared/          claude.ts · env.ts · http.ts   (reusable, no domain logic)
│       ├── dossiers/        domain logic with more than one caller (PDF, SRGSSR, mailbox)
│       ├── endpoints/       custom HTTP routes
│       ├── hooks/           filter/action hooks on collection writes
│       ├── operations/      steps a Flow can call (this is how cron works)
│       └── types/schema.ts  typed view of the collections
├── extensions/.registry/    marketplace extension: TypeScript type generator
├── migrations/              empty by design — row data only, never the model
├── schema/                  directus-sync dump — the data model, single source of truth
├── templates/*.liquid       invite/reset emails; name and logo come from project settings
├── docker/entrypoint.sh     container boot: migrate → bootstrap → start → schema push
└── docker-compose.yaml      LOCAL DEV DATABASE ONLY (the full stack is at the repo root)
```

## Commands

| Command                    | What it does                                                              |
| -------------------------- | ------------------------------------------------------------------------- |
| `npm run setup`            | `.env` from the example, install, build the extension bundle              |
| `npm run db:start`         | Postgres in Docker (detached)                                             |
| `npm run directus:init`    | Bootstrap a fresh database, migrate, apply the schema. **First run only** |
| `npm run dev`              | Postgres + Directus on the host                                           |
| `npm run build`            | Compile every extension bundle (`npm ci` per bundle) and any migrations   |
| `npm test`                 | Vitest in the extension bundle                                            |
| `npm run typecheck`        | `tsc --noEmit` for the bundle (and migrations, if any)                    |
| `npm run database:migrate` | Compile `*.mts`, then `directus database migrate:latest` (rare)           |
| `npm run schema:dump`      | Live Directus → `schema/` (**run this after every model change**)         |
| `npm run schema:diff`      | What a push would change                                                  |
| `npm run schema:load`      | `schema/` → live Directus (diff-and-apply, safe to repeat)                |
| `npm run db:reset`         | **Destructive.** Drops the dev database volume                            |

`schema:dump` / `schema:load` need a running Directus plus `DIRECTUS_URL` and either
`DIRECTUS_TOKEN` or `DIRECTUS_ADMIN_EMAIL`/`DIRECTUS_ADMIN_PASSWORD` in `.env`.

## Changing the data model

**Always through schema sync.** `schema/` is the single source of truth for the whole
model: collections, fields, relations, roles, policies, permissions, presets,
dashboards, translations and Flows. The loop never changes:

1. Create/change it at http://localhost:8055 (admin UI).
2. `npm run schema:dump`.
3. Commit `schema/`. Colleagues and every container get it via `schema:load` — a
   diff-and-apply, safe to repeat, and the last step of the container boot.

A fresh database reaches the current model with `schema:load` alone — this is exactly
how `dossiers` and `editions` are bootstrapped now (they were originally created by
migrations, converted to schema-as-code on 2026-08-23; see git history if you need
the old shape). That is the whole mechanism, and it is also the reason it stays
reliable: one owner, one artefact to review in a diff.

Use it for structure _and_ for everything with presentation metadata — interfaces,
field order, icons, translations, roles, permissions, dashboards, Flows. Directus
writes that metadata for you; hand-written SQL does not.

After changing the model, update `extensions/app/src/types/schema.ts` and the
frontend's GraphQL documents (`apps/front/src/graphql/`).

### Migrations are the exception, not the alternative

**Never create or alter a collection, field or relation in a migration.** Two owners
drift, quietly: on a fresh boot the migration runs first, so the schema push then
diffs against whatever the migration built instead of creating its own version — a
detail the migration got wrong or left out can survive the push, and the same
collection is now defined twice, in two files that no longer agree. A table without
`directus_collections`/`directus_fields` rows is also a collection your colleagues can
neither see nor edit in the admin UI. If a model change _feels_ like it needs a
migration, the answer is still: do it in the admin UI and dump.

`migrations/*.mts` is for **rows, not structure**: a backfill after a new field was
dumped, a one-off data repair, recomputing a derived column. Even there, prefer in
this order:

1. Admin UI + `schema:dump` — anything structural, no exceptions.
2. A Flow operation triggered once from the Flow editor — data work that should go
   through Directus services (hooks, permissions, an LLM call) or be re-runnable.
3. A migration — only when 1 and 2 genuinely cannot do it: a bulk `UPDATE` over a
   large table, or an index Directus does not manage. Say why in the file header.

Rules for the rare migration you do write:

- Filename `YYYYMMDDA-description.mts` — the leading number must be unique and sorts
  the run order. Directus records applied versions in `directus_migrations`.
- Write **`.mts`**, never `.js`: `npm run database:migrate` compiles them to `.mjs`
  (Directus' migration runner only loads `.js`/`.mjs`/`.cjs` and ignores `.ts`). The
  compiled files are gitignored.
- Export `up(knex)` and `down(knex)`. Assume it may run against a database that
  already has data.
- Touch data only. No `schema.createTable`, no added or dropped columns, no inserts
  into `directus_collections` / `directus_fields` / `directus_relations`.
- Never edit a migration that has run somewhere. Add a new one.

`migrations/` is empty in this repo, and that is the healthy state. `npm run
build:migrations` and `npm run typecheck` skip the folder while it holds no `*.mts`
(they guard with `ls migrations/*.mts`) — a bare `tsc -p migrations` errors on an
empty `include`, so don't drop that guard even temporarily.

## Adding server-side logic

Everything goes into the single bundle at `extensions/app`. Three entry types, and
the choice matters:

### Endpoint — the frontend calls it

`src/endpoints/<name>/index.ts`, registered under `directus:extension.entries` in
`extensions/app/package.json`. Mounted at `/<name>`.

```ts
export default defineEndpoint((router, { services, getSchema, logger }) => {
  router.post('/:id', async (req: ApiRequest, res, next) => {
    if (!isAuthenticated(req)) return next(new ForbiddenError())
    const items = new ItemsService('dossiers', {
      schema: await getSchema(),
      accountability: req.accountability
    })
    // …
  })
})
```

- **Endpoints are public by default** — Directus mounts them before its permission
  layer. Every endpoint must decide explicitly who may call it. This is the most
  common security bug in a Directus extension.
- Pass `accountability` to a service so the caller's permissions apply. Omit it only
  where the code must deliberately act as the system, and say why in a comment.
- Read and write through `services.ItemsService`, not raw `database` — services run
  hooks, validation and permissions. Use knex only for reporting-style queries.
- **`readOne` never returns `null`.** It throws `ForbiddenError` for an item that is
  missing _or_ not readable by the caller, and for a malformed key. Do not write a
  `=== null` check — it is dead code. Match on it with
  `isDirectusError(error, ErrorCode.Forbidden)` and answer **403**, never your own
  404: the ambiguity is deliberate, because two different answers let a caller probe
  which ids exist. Re-wrap it only to get a German message, and let anything else
  from the read fall through to a logged 500 instead of being mislabelled.
- Return errors via `createError` from `@directus/errors` and `next(err)`. Log the
  cause; never return a raw provider error to the browser (it can contain the prompt).
- Wrap only the part that can genuinely fail. A single `try` around the whole
  handler turns every bad request into the same 502: give the caller's mistakes
  their own 4xx (see `InvalidDossierIdError` in `dossier-process`) and keep the
  generic 5xx for what really is a fault.
- Working example: `src/endpoints/dossier-process/`. `src/endpoints/dossiers-ingest/`
  is a second one, sharing its actual logic (`dossiers/ingest-mailbox.ts`) with the
  scheduled `dossiers-ingest-imap` operation - same "endpoint for manual/testing,
  operation for scheduled, one shared module for the real work" shape as
  dossier-process/dossiers-process-pending.

### Hook — react to a write, from any source

`src/hooks/<name>/index.ts`. A hook fires for every write path (admin UI, REST,
GraphQL, other extensions), which makes it the right place for invariants.

- `filter('<collection>.items.create'|'.update')` runs **before** the write and must
  return the payload — the only place that can still change what gets stored.
- `action(...)` runs after and cannot change anything: use it for side effects.
- Hooks block the request. Nothing slow belongs here — that is what Flows are for.
- Anything derived by an LLM is a cache: invalidate it in a hook when its source
  changes, so a stale summary can never outlive the text it describes. Example:
  `src/hooks/editions-guard-publish/` (a different invariant - blocks publishing an
  edition without an `audio_url` - but the same "enforce on every write path" shape).

### Operation — a step a Flow can call. **This is how scheduled work is done.**

`src/operations/<name>/{api.ts,app.ts}` — `api.ts` is the handler, `app.ts` describes
it in the Flow editor.

To schedule it ([Directus trigger docs](https://directus.com/docs/guides/flows/triggers)):

1. Settings → Flows → Create Flow → Trigger **Schedule (cron)**, e.g. `0 7 * * *`.
2. Add your operation, fill in its options, save.
3. `npm run schema:dump` — the Flow is now in version control and every environment
   gets it.

Crons fire in the **process timezone**: `TZ=Europe/Zurich` is set in the Dockerfile
and compose so `0 7` means 07:00 Swiss wall-clock all year.

Write scheduled handlers to be idempotent and **bounded** — a scheduled run can
overlap a previous one, and an unbounded run is how a nightly job turns into a
surprise API bill. Example: `src/operations/dossiers-process-pending/` (a `limit`
option, one dossier at a time, one bad dossier skipped rather than aborting the
batch).

## Calling Claude

`src/shared/claude.ts` is the only place that talks to a model.

```ts
const answer = await completeJson<unknown>({
  system: SYSTEM_PROMPT,
  prompt,
  maxTokens: 1024
})
const validated = parseSummary(answer) // never trust the shape
```

- `completeText` / `completeJson` throw `ClaudeTruncatedError` when the model hit
  `max_tokens`. A truncated answer looks valid to the caller and truncated JSON is
  the classic silent failure — never "recover" by using a partial answer.
- `completeJson` strips code fences and surrounding prose (`extractJson`), but the
  type parameter is a promise, not a proof. Validate before writing to a collection.
- Both take an optional `MessageSender` so tests inject a stub and never hit the
  network. See `src/shared/claude.test.ts`.
- Keep prompts in their own module (`dossiers/topics-prompt.ts` - here it's shared by
  the endpoint and the operation rather than living next to a single handler, since
  both call `process-dossier.ts`) so prompt building and answer validation are
  unit-testable without a network call. Do this for every AI feature.
- **Store each part of an answer in its own field.** Packing structured output into
  one text column forces the frontend to parse it back apart, which is the same
  format written twice in two packages — they drift. Use a `cast-csv` column for a
  flat list or `cast-json` for anything nested (`editions.extra_topics`: an array of
  `{headline, paragraphTimestamp, paragraphSeconds, summary}`). The mapping from
  validated answer to columns is one pure function (`editionFields`), shared by the
  endpoint and the Flow operation so the two cannot diverge.
- Model: `ANTHROPIC_MODEL`, default `claude-sonnet-5`. Reach for `claude-opus-5` for
  genuinely hard reasoning, not by default.
- `ANTHROPIC_API_KEY` lives **here**, never in the frontend.

## Environment variables

`.env` locally (from `.env.example`), the `directus` service in the root
`docker-compose.yml` in Docker. Adding one means editing **three** files:
`apps/directus/.env.example`, the root `.env.example`, and `docker-compose.yml`.

Read them through `shared/env.ts` (`requireEnv` names the missing variable in the
error) — never `process.env` scattered across handlers.

## Types

`src/types/schema.ts` is hand-maintained, or regenerated by the bundled
**TypeScript Types** module in the admin UI (`extensions/.registry`, from
`directus-extension-ts-typegen`) — paste its output over the file. The frontend does
not import it; it generates its own types from GraphQL.

## Container boot

`docker/entrypoint.sh`, in order: compile migrations → `directus bootstrap` (installs
on an empty database, migrates otherwise) → start Directus → wait for
`/server/health` → `directus-sync push`. It is idempotent: a redeploy re-runs all of
it against the existing database. The last step is the one that matters — it is how
every environment gets the model in `schema/`; the migration step is a no-op in this
project, which has none. `RUN_SCHEMA_SYNC=false` skips the schema push, which means
deploying code against an unchanged model.
