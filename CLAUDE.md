# Regionaljournal-Pipeline — Monorepo Entry Point

Turns the daily SMD "Dossier" PDF (auto-transcribed SRF Regionaljournal Basel
Baselland segments) into an editorial review tool: parse the PDF into per-story
`editions`, resolve each story's SRF audio via the SRGSSR Audio Metadata API,
summarise secondary topics with Claude, and let an editor review/publish from a
login-gated frontend. Built on [wepublish/exotemplate](https://github.com/wepublish/exotemplate)
(see [Domain: dossiers and editions](#domain-dossiers-and-editions) for the project-specific shape); the old
Python proof-of-concept lives on the `main` branch, this one (`umbau` onward) is the
TypeScript rebuild on that template.

It is a **monorepo** — both apps live side by side under `apps/`. It is **not** an
npm workspace: each app is installed, built and deployed independently and has its
own lockfile. The root carries the shared pre-commit tooling, CI, and the
docker-compose file that runs the whole stack.

## The stack — fixed, not a suggestion

| Path                             | Purpose                                                        | Stack                                 | Port |
| -------------------------------- | -------------------------------------------------------------- | ------------------------------------- | ---- |
| [apps/directus/](apps/directus/) | Backend: data model, **all** server-side logic, scheduled work | Directus 11, TypeScript, Postgres 16  | 8055 |
| [apps/front/](apps/front/)       | Frontend: UI only                                              | Next 16 (App Router), React 19, MUI 9 | 3000 |

Data flows one way through one door:

```
   browser
      │  same-origin /api/* only (httpOnly session cookies, no tokens in JS)
      ▼
┌─────────────────────┐   Apollo Client → /api/graphql → Directus GraphQL
│     apps/front      │   fetch        → /api/…        → extension endpoint
│  Next 16 · MUI 9    │
└──────────┬──────────┘
           │ server-side only, with the user's access token
           ▼
┌─────────────────────┐
│    apps/directus    │  Directus 11 + one extension bundle
│  data + all logic   │──► Claude API (https, CPU only)
└──────────┬──────────┘
           ▼
      Postgres 16
```

## Hard constraints

These are requirements of the platform, not preferences. A change that breaks one of
them is wrong even if it works.

1. **Runs on a machine without a GPU.** No local inference, no CUDA, no model
   weights, no vector database that needs a GPU. If a feature seems to need a local
   model, it needs the Claude API instead.
2. **Claude API for every LLM call.** One client:
   `apps/directus/extensions/app/src/shared/claude.ts`. Never add a second provider,
   a second SDK, or a direct `fetch` to an inference endpoint.
3. **Runs with Docker.** `cp .env.example .env && docker compose up --build` starts
   the entire application. Anything a feature needs at runtime is a service or an
   environment variable in [docker-compose.yml](docker-compose.yml).
4. **Self-contained.** Postgres, Directus and the frontend are the only services. No
   Redis, no queue broker, no external cron host, no side-car. The Claude API is the
   single outbound dependency; a new one needs a deliberate decision, not a commit.
5. **No persistent file storage outside Directus.** Application code never writes to
   the filesystem — no temp caches, no JSON state files, no log files, no
   `./data`. State goes into a Directus collection; binaries go through Directus
   Files (one named volume). Containers are disposable: anything written outside a
   volume is gone on the next deploy.
6. **TypeScript only.** All logic — backend, frontend, migrations, scripts. No
   Python, no shell scripts carrying business rules. `apps/directus/docker/entrypoint.sh`
   is the one exception and it only orchestrates commands.
7. **Server-side code lives in the Directus extension bundle.**
   `apps/directus/extensions/app` — endpoints, hooks and Flow operations.
   [Extension docs](https://directus.com/docs/guides/extensions/overview). Next
   route handlers are proxies only: they forward a request and never contain a rule,
   a prompt or a calculation.
8. **Scheduled work is a Directus Flow with a Schedule (cron) trigger.**
   [Trigger docs](https://directus.com/docs/guides/flows/triggers). No system cron,
   no `setInterval` in a hook, no scheduler container. The Flow calls a custom
   operation from the bundle; the Flow itself is committed via `schema:dump`.
9. **The data model is synced, never migrated.** Collections, fields, relations,
   roles, permissions and Flows are built in the Directus admin UI and committed with
   `npm run schema:dump` (directus-sync → `apps/directus/schema/`). A migration must
   never create or alter structure; `apps/directus/migrations/` is a last resort for
   row data — see [apps/directus/CLAUDE.md](apps/directus/CLAUDE.md).

## Where does this feature go?

| The change is…                             | Goes to                                                                             |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| a new collection, field, relation or role  | Directus admin UI, then `npm run schema:dump` — [apps/directus](apps/directus/)     |
| a calculation, validation or business rule | extension bundle (endpoint or hook)                                                 |
| anything that calls Claude                 | extension bundle, via `shared/claude.ts`                                            |
| something that must run nightly/hourly     | Flow with a Schedule trigger + a custom operation in the bundle                     |
| a screen, a form, a list, a chart          | [apps/front](apps/front/) — MUI components, Apollo for data                         |
| a new query the UI needs                   | `apps/front/src/graphql/*.ts`                                                       |
| a one-off data repair or backfill          | rows only: a one-shot Flow, else `apps/directus/migrations/*.mts` as a last resort  |
| a new environment variable                 | `apps/directus/.env.example` **and** root `.env.example` **and** docker-compose.yml |

A change that spans both apps starts in `apps/directus` — data model first, then the
GraphQL documents in the frontend.

## Cross-cutting conventions

- **Formatter**: Prettier — no semicolons, single quotes, no trailing commas, 2-space
  indent, 110 columns. Enforced by a **root** Husky + lint-staged pre-commit hook
  across the whole tree.
- **No ESLint.** Prettier plus `tsc --noEmit` (`npm run typecheck`) is the gate.
- **TypeScript strict mode** everywhere, plus `noUncheckedIndexedAccess`.
- **UI labels in German, code and comments in English.** Error messages that reach a
  browser are UI labels — German.
- **Node 22.x**, package manager `npm`, in both apps.
- **Tests by default for new logic.** Vitest in the extension bundle, Jest +
  Testing Library in the frontend. Both are wired and run in CI. Skip only with a
  concrete reason (thin glue, framework plumbing, purely cosmetic). Put the rule in
  a pure function next to the wiring and test that — the pattern is everywhere in
  the example feature.
- **Secrets live in the backend.** The frontend holds no API key and no service
  token; it acts as the signed-in user. See [apps/front/CLAUDE.md](apps/front/CLAUDE.md).
- **Keep the CLAUDE.md files current.** After landing a change, update this file
  and/or the app's when the change affects something a future agent would rely on —
  new endpoint, collection, command, env var, pattern, or a fact that is now wrong.
  Skip it for routine fixes, refactors that don't change shape, dependency bumps and
  copy tweaks. When in doubt: would the next agent be misled by the current text?

## Running it

**Everything in Docker** (what deploys, one command):

```bash
cp .env.example .env         # then put your ANTHROPIC_API_KEY in it
docker compose up --build    # or: npm run up
```

**Local development** (fast feedback, three terminals):

```bash
cd apps/directus/extensions/app && npm run dev   # 1. watch-rebuild the bundle — start first
cd apps/directus && npm run dev                  # 2. Postgres in Docker + Directus on the host
cd apps/front && npm run dev                     # 3. Next dev server
```

Start the extension watcher **before** Directus: Directus refuses to start without a
built bundle, and without the watcher your changes are never picked up.

- Frontend: http://localhost:3000
- Directus admin: http://localhost:8055 — `admin@wepublish.ch` / `admin123`

## Domain: dossiers and editions

Two collections, decoupled by status:

- **`dossiers`** — one row per incoming PDF (manual upload or IMAP). `status`:
  `pending` → `processing` → `processed`/`failed`. `source_file` (FK →
  `directus_files`), `source_message_id`/`source_subject` (IMAP provenance,
  nullable), `error_message`, `processed_at`.
- **`editions`** — one row per story a dossier resolves to (a PDF can contain
  segments from several broadcast editions/days). `status`: `draft`/`published`/
  `archived` (the template's `notes` status pattern). `dossier` (FK), `headline`,
  `lead`, `teaser_blocks`/`transcript`/`extra_topics` (all `cast-json`), `audio_url`,
  `srgssr_urn`, `resolution_error` (set instead of `audio_url` when SRGSSR
  resolution fails for that story — never aborts the rest of the dossier).

Domain logic lives in `apps/directus/extensions/app/src/dossiers/` — a fourth
top-level category alongside `shared/`/`endpoints/`/`hooks/`/`operations/`, for logic
with more than one caller (the manual endpoint and the scheduled operation both need
PDF parsing, SRGSSR resolution and Claude topic extraction):

- `pdf-parser.ts` — `parseDossier(buffer): Segment[]`, via `pdfjs-dist`. The
  extension bundler inlines this module into a single `dist/api.js`, which breaks
  pdfjs-dist's own worker-file lookup — `GlobalWorkerOptions.workerSrc` is resolved
  explicitly via `createRequire(...).resolve(...)` at the top of the file. Don't
  remove that without re-testing a real `docker compose up --build` run: the Vitest
  suite runs against un-bundled source and won't catch a regression here.
- `srgssr-client.ts` — OAuth2 client-credentials, title+date episode matching.
  In-memory token/show-id cache only (per client instance) — never a file cache.
- `topics-prompt.ts` — builds/validates the Claude call that matches a dossier's
  "Ausserdem" headlines to a transcript timestamp and summary.
- `process-dossier.ts` — orchestrates the three into `editions` rows, shared by
  `endpoints/dossier-process` and `operations/dossiers-process-pending`.
- `mailbox.ts`/`select-messages.ts`/`ingest-mailbox.ts` — IMAP fetch, "what counts as
  a new dossier message", and the upload-and-create-row orchestration, shared by
  `endpoints/dossiers-ingest` (the "Postfach jetzt prüfen" button) and
  `operations/dossiers-ingest-imap`. Dedup is against **this Directus instance's own
  `dossiers.source_subject`**, not the mailbox's `\Seen` flag — `\Seen` lives on the
  mailbox, shared across every environment that ever connects to it (a fresh server
  deployment, a colleague's local setup), so it cannot tell "already in this
  database" from "already looked at somewhere". A message is still marked `\Seen`
  after a successful ingest, purely for mailbox hygiene, never relied on for
  correctness. `mailbox.ts`'s fetcher keeps the IMAP mailbox locked
  (`getMailboxLock`, not a bare `mailboxOpen`) and the connection open across the
  whole ingest, not just the fetch — closing early was a real bug: a message's
  `markSeen()` needs a live connection to call at upload/create time, which is well
  after the fetch itself returned.

`SRGSSR_CLIENT_ID`/`SRGSSR_CLIENT_SECRET` are read with `optionalEnv`, not
`requireEnv`, on purpose: missing or wrong credentials must fail per-segment
(`resolveEpisode` throws, caught in `process-dossier.ts` and stored as
`resolution_error`) rather than crashing the whole dossier.

Two Flow Schedule triggers are expected but must be created by hand in the admin UI
(Settings → Flows → Create Flow → Trigger "Schedule (cron)"), then versioned with
`npm run schema:dump`: one for `dossiers-ingest-imap` (mailbox polling, default limit
5), one for `dossiers-process-pending` (PDF processing). Until that Flow exists (or
for an ad-hoc catch-up — e.g. recovering a mailbox backlog onto a freshly deployed,
empty database), the "Postfach jetzt prüfen" button in `DossiersPanel` calls
`endpoints/dossiers-ingest` directly. That endpoint only creates `pending` dossiers;
it never calls `process-dossier` itself — chaining several 15-35s processing calls
into one HTTP request risks a reverse-proxy timeout on a real deployment, so
processing stays the separate, already-existing per-dossier step.

## Deployment

Images are published to GHCR, named after the repository:

- **Staging** — a push to `main` rebuilds only the app whose `apps/<app>/**` changed:
  `ghcr.io/<owner>/<repo>-backend:main`, `ghcr.io/<owner>/<repo>-front:main`.
- **Production** — a `v*` tag builds **both** images in lockstep:
  `…-backend:production` and `…-front:production`.

One reusable builder ([publish-docker-image.yml](.github/workflows/publish-docker-image.yml))
takes a build `context` and image `tags`; the per-app workflows call it with path
filters. [verify.yml](.github/workflows/verify.yml) typechecks, tests and builds both
apps on every push and PR. GitHub only reads workflows at the repo root, so both
apps' pipelines live in `.github/workflows/`.

On a server, deploy the same `docker-compose.yml` with real values in `.env`
(`KEY`, `SECRET`, `DB_PASSWORD`, `ADMIN_PASSWORD`, the public URLs) and a reverse
proxy in front for TLS.

## Things to know before editing

- **Not an npm workspace.** No hoisting, no shared `node_modules`. Always `cd` into
  `apps/directus` or `apps/front` first. The root `npm install` only installs the
  pre-commit tooling — never add app dependencies to the root `package.json`.
- The extension bundle is a **third** npm package with its own `node_modules`:
  `apps/directus/extensions/app`. Its `package-lock.json` is committed and
  `npm run build` installs it with `npm ci` — so a dependency change means running
  `npm install` inside the bundle and committing the lockfile, or the build fails.
- Directus is pinned to **11.x** on purpose. `directus-sync` (schema-as-code) has no
  Directus 12 release, and the bundled `ts-typegen` module declares
  `host: ">= 10.10.0 < 12.0.0"`. Check both before bumping the major.
- The pre-commit hook is installed at the git root (`.husky/`).
- Never commit any `.env`. The root `.env` configures Docker; `apps/directus/.env`
  and `apps/front/.env.local` configure local development.
