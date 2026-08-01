# Environment

## Per-app env files, not one root file

There is no root `.env`. Every surface that runs as its own process owns its own file, copied from the `.env.example` sitting next to it:

| File | Loaded by | Used by |
| --- | --- | --- |
| `apps/api/.env` | Bun's automatic `.env` loading, plus `ConfigModule.forRoot()` | the NestJS API |
| `apps/app/.env` | Next.js | the Next.js app; `NEXT_PUBLIC_*` are inlined at build time |
| `packages/db/.env` | `import "dotenv/config"` in `packages/db/prisma.config.ts` | the Prisma CLI — `db:migrate`, `db:push`, `db:studio`, `db:seed` |

`packages/auth/.env.example` documents what `@crm/auth` reads, but there is deliberately no `packages/auth/.env`. The package is a library: it never loads a file, it just reads whatever `process.env` its host process already has. If a var is missing there, fix the API's or the app's `.env` — adding one next to the package would do nothing.

Because each loader reads from its own process's working directory, the API only sees `apps/api/.env` when started from `apps/api` — which is what `bun dev` / `turbo run dev` does. Running `bun src/main.ts` from the repo root silently gets you no env at all.

## Values that must match across files

Three variables are duplicated, and nothing checks that the copies agree:

- **`DATABASE_URL`** — `apps/api/.env`, `apps/app/.env`, `packages/db/.env`. The app reads sessions straight from the database, and Prisma's CLI needs its own copy because it runs outside both apps.
- **`BETTER_AUTH_SECRET`** — `apps/api/.env` and `apps/app/.env`.
- **`BETTER_AUTH_URL`** — `apps/api/.env` and `apps/app/.env`.

A mismatched `BETTER_AUTH_SECRET` is the one to watch: the API mints a session cookie the app cannot verify, so `requireSession()` rejects every request and you get an endless bounce back to `/sign-in` with no error anywhere. If sign-in "succeeds" but you land on the sign-in page again, compare the secrets before debugging anything else.

## Typed, validated env

Only the API validates. Everything else fails later and less clearly, so know which layer you are in:

- **`apps/api/src/config/env.validation.ts`** — the real one. A class-validator `EnvironmentVariables` class run through `ConfigModule.forRoot({ validate: validateEnv })`; it fails fast at boot with a message naming each bad variable. New API config belongs here.
- **`packages/db/src/client.ts`** — throws if `DATABASE_URL` is unset, pointing at `packages/db/.env.example`.
- **`packages/auth/src/env.ts`** — no schema. Plain `process.env` reads through an `optional()` helper, with one rule enforced: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` must be set together or it throws. Anything else missing just becomes `undefined`.
- **`apps/app/lib/api.ts`** — `process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"`. A silent fallback, so a missing var in a deployed app looks like "the API is down" rather than a config error.

### Two sharp edges

**`@crm/auth` reads env at import time.** `packages/auth/src/env.ts` builds its `env` object, and `auth.ts` builds `socialProviders`, while the module is being imported — not on first use. `app.module.ts` imports `@crm/auth` before `ConfigModule.forRoot()` runs, so the vars have to already be in `process.env` by then. Under Bun they are, because Bun loads `.env` before executing anything. Under plain Node or `nest start` they would not be: `@nestjs/config` loads the file *after* that import, so Google sign-in would vanish silently (`socialProviders: {}`) while `validateEnv` still passed, because it reads the same variables a moment later. If the API ever moves off Bun, load the env file explicitly before importing `AppModule`.

**`main.ts` bypasses the validated `PORT`.** It reads `process.env.PORT ?? 3001` directly, so the `@IsInt() @Min(1) @Max(65535)` constraint on `EnvironmentVariables.PORT` never applies to the value actually used. Read it off `ConfigService` instead.

## Turbo and env

Turborepo 2 runs in strict env mode: a task sees only the variables it declares, so **adding a variable to a `.env` file is not enough — the task that needs it must list it too.**

- Root `turbo.json` sets `globalEnv: ["NODE_ENV"]` and makes `.env*` a `build` input, so editing any env file correctly invalidates the build cache.
- `apps/api/turbo.json` declares `passThroughEnv` for `dev` and `test` (auth, database, Google, cache, port).
- `apps/app/turbo.json` declares `env` for the two `NEXT_PUBLIC_*` values — they are build inputs because Next inlines them — and `passThroughEnv` for the server-side ones.
- `packages/db/turbo.json` and `packages/auth/turbo.json` pass `DATABASE_URL` through to every `db:*` / `auth:generate` task.

The split matters: `env` participates in the cache key, `passThroughEnv` does not. Secrets belong in `passThroughEnv` so changing one doesn't churn the cache; anything baked into build output (the `NEXT_PUBLIC_*` pair) belongs in `env`, or Turbo will serve a stale build that inlined the old value.

## Google OAuth

Google is the only sign-in method, wired unconditionally in `packages/auth/src/auth.ts`. Credentials live in `apps/api/.env` only — the app never mounts the auth handler.

Create a web OAuth client in Google Cloud → Credentials, and register the redirect URI:

```
http://localhost:3001/api/auth/callback/google
```

Add the deployed equivalent (`https://<api-host>/api/auth/callback/google`) for each environment. `AUTH_TRUSTED_ORIGINS` is the comma-separated allow-list of origins permitted to call the API with credentials, and doubles as the allow-list Better Auth validates post-sign-in `callbackURL`s against — the Next.js origin belongs there.

The provider sets `accessType: "offline"`, which is what makes Google issue a refresh token. Without it nothing breaks at sign-in, but every Gmail/Calendar connection dies an hour after it is made with nothing to refresh from.

## Gmail and Calendar sync

Always on. Same OAuth client, same callback — the two read-only scopes are added to the existing Google provider rather than to a second one, so there is no extra redirect URI to register.

The scopes are requested **at sign-in** and are a condition of using the CRM: `requireGoogleAccess()` gates the app shell on what Google actually granted, because granular consent lets a user untick a scope and still complete sign-in. Anyone missing either scope is sent to `/grant-access` to re-consent. There is deliberately no "disconnect" — see the plan §3.4.

**Sync is forward-only.** Nothing from before a mailbox was first seen is imported: Gmail records the current `historyId` on its first pass and imports nothing, and Calendar reads from `now` onwards. A calendar event already in the diary for next week does show up, because it starts in the future — that is not back-dating.

| Variable | Required | Notes |
| --- | --- | --- |
| `CRON_SECRET` | yes, in deployed environments | Bearer guard on `POST /internal/sync/google`. Vercel sends it automatically as `Authorization: Bearer $CRON_SECRET`. Minimum 16 characters; the route **fails closed** if unset, so locally the cron simply never runs. |

That is the whole list, and the absences are deliberate:

- **No `GOOGLE_SYNC_ENABLED`.** A feature flag only earns its keep when it gates something that can genuinely be absent — `CONTEXT_DEV_API_KEY` does, because without a key there is no API call to make. Sync has everything it needs the moment the app boots: the OAuth client is already mandatory because Google is the only sign-in, and mailbox scopes are a condition of having an account. A switch that can turn off a mandatory feature, defaulting to off, is a switch that is only ever wrong.
- **No `GOOGLE_WORKSPACE_DOMAIN`.** Our own domains are derived from the `User` table, which already holds them. Sign-in is Google-only behind an Internal consent screen, so every user is on a company domain by construction — and a derived value cannot go stale the day the team adds a second domain.
- **No `GMAIL_BACKFILL_DAYS`.** There is no backfill.

Two things to do in Google Cloud before this works:

- **Enable the Gmail API and the Google Calendar API** on the project.
- **Set the consent screen to User type: Internal.** `gmail.readonly` is a *restricted* scope; an External app using it needs OAuth verification plus an annual CASA security assessment. For an Internal app Google's documentation is explicit that restricted scopes need no further review. Going External later means the full review, so this is a decision, not a checkbox.

The cron is declared in `apps/api/vercel.json` at `*/5 * * * *`. Minute-level schedules need a Pro plan; on Hobby it silently becomes daily.

## Database

Prisma is driven through turbo from the repo root: `db:generate`, `db:migrate`, `db:push`, `db:reset`, `db:seed`, `db:studio`, `db:deploy`. Config lives in `packages/db/prisma.config.ts`, which loads `packages/db/.env` itself, so the CLI works without any app running.

## What is not an env var

- **Cache TTL default** — `DEFAULT_TTL_MS` (60s) is a constant in `apps/api/src/cache/cache.module.ts`. `CACHE_TTL_MS` only overrides it.
- **Redis** — optional. Without `REDIS_URL` the cache falls back to a per-instance in-memory store, which is fine for local work and wrong for any multi-instance deploy (see `docs/api.md`).
- **Sign-in method** — Google-only, in code, not configurable.

## Secrets hygiene

`.env` files are gitignored, but the patterns are name-exact and inconsistent between packages. Two things to know:

- **Root and `apps/api/.gitignore` list specific names** (`.env`, `.env.local`, `.env.*.local`). A file like `.env.bak` or `.env.old` is **not** ignored and will be committed if you `git add -A`. Never leave a timestamped backup of a real `.env` in the tree.
- **`apps/app/.gitignore` uses `.env*`**, which is broader — and catches the template too. `apps/app/.env.example` is currently untracked and ignored because of it, so a fresh clone gets no template for the web app while the other three packages ship theirs. Fix with a negation (`!.env.example`) in that file.

`packages/auth/.env.example` ships a filled-in `BETTER_AUTH_SECRET` as an illustration. Treat it as a placeholder, not a value: generate your own with `openssl rand -base64 32`.
