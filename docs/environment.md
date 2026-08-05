# Environment

Setup, local dev and the `vercel env pull` hazard are in `docs/setup.md`.

## One `.env`, at the repo root

`.env.example` **is the documentation** — every variable the repo reads, with a note,
and nothing that is not read. `packages/env` walks up to the workspace root and reads
`.env`, then `.env.local` on top.

- **Real environment variables always win** — the loader never overwrites
  `process.env`, so Vercel/Docker/CI takes precedence.
- **Never add a per-package `.env`.** Four once existed with duplicate
  `DATABASE_URL`/`BETTER_AUTH_SECRET`; when they drifted the API minted a cookie the
  app could not verify and the browser bounced between `/sign-in` and `/` forever.
- **The root marker is a `package.json` declaring `workspaces`** — stopping at the
  first `turbo.json` resolves the API's root to `apps/api`.

## Required

`DATABASE_URL`, `BETTER_AUTH_SECRET`, `ALLOWED_SIGN_IN`. Everything else has a
localhost default or is genuinely optional.

**`GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`** are the sign-in button *and* the
Gmail/Calendar sync — optional, so an SSO-only install needn't create a Google project,
but **set together or not at all** (`packages/auth/src/env.ts` throws on one).

**`ALLOWED_SIGN_IN`** — comma-separated whole domains or single addresses. Bare
addresses exist for a solo self-hoster where `gmail.com` would be an open door. **One
list, read by the sign-in guard *and* the sync's "which side is external" decision** —
if they drifted a colleague would be refused at the door or filed as a lead. **An empty
list fails closed.** Parsed on demand, not at import.
`packages/auth/src/workspace.ts`.

## Where things are

- **`API_URL`** (`:3001`) mints session cookies and serves `/api/auth/*`;
  `next.config.ts` republishes it as `NEXT_PUBLIC_API_URL`, so one variable does both
  sides. `BETTER_AUTH_URL` is a legacy fallback.
- **`APP_URL`** (`:3000`) is also the trusted-origin and `callbackURL` allow-list;
  comma-separate if multi-origin, first is canonical.
- **`AUTH_COOKIE_DOMAIN`** only for API and app on different subdomains of one parent.
- **`AGENT_URL`** is the agent's deployment, server-side only, and **must include the
  scheme** — validated at boot, or it throws when a task is queued instead.
- **`AUTH_COOKIE_PREFIX` is `crm`** (`@crm/auth/cookies`), set on **both**
  `advanced.cookiePrefix` in `auth.ts` and `getSessionCookie(request, { cookiePrefix })`
  in `proxy.ts` — one alone redirects every signed-in request. Better Auth's default
  collides with any neighbour on a shared parent domain, and the failure is silent:
  sign-in completes, the row is written, every reader resolves `null`. **Changing it
  signs everybody out**, once.

## `IS_MARKETING` — landing page flag, off by default

`"true"` serves `app/(landing)` at `/`; anything else sends a signed-out visitor to
`/sign-in`, because the page markets *this* product.

- **Only the literal `true`** (same shape as `PRISMA_LOG_QUERIES`).
- **It decides one thing**: what a stranger at `/` sees.
- **`isMarketing()` (`apps/app/lib/env.ts`) reads per request**, so a config change
  needs no rebuild. Declared in `apps/app/turbo.json` `passThroughEnv`.

## Typed, validated env

`apps/api/src/config/env.validation.ts` runs via `ConfigModule.forRoot({ validate })`.
It lists every variable the API reads and nothing else.

- **Validation runs while `AppModule` is evaluated** — a test must set variables before
  importing it (see the dynamic `import()` in `test/auth.e2e.spec.ts`).
- **The schema is the API's, not the repo's** — `@crm/auth` and the agent read their own
  values.

## Optional: what the agent can do

Every outside source is optional and the agent runs with none. A missing key removes a
place to look; **never an error, never throws**.
`apps/agent/agent/lib/capabilities.ts` is the single place that knows what is set.

| Variable | What it adds |
| --- | --- |
| `PERPLEXITY_API_KEY` | Open-web research with citations; finds a LinkedIn slug |
| `RAPIDAPI_KEY` | LinkedIn profiles via LinkDAPI |
| `GITHUB_TOKEN` | Raises the GitHub rate limit from 60/hour |
| `BLOB_READ_WRITE_TOKEN` | Mirrors logos and photos into Blob |
| `AI_GATEWAY_API_KEY` | The model. Not needed on Vercel (OIDC) |
| `AGENT_BRIDGE_SECRET` | The rep-facing Agent panel — see `agent.md` |

`BLOB_READ_WRITE_TOKEN` is also in `env.validation.ts` and `apps/api/turbo.json`
because the API and the seed write pictures too. The Next.js app is deliberately
excluded — recognising our URL for the image optimizer needs no token.

### The Context key is asked for, not configured

**`CONTEXT_DEV_API_KEY` is not a variable here and must not become one.** The key lives
in `AppSetting`, is asked for at `/onboarding/research`, and is changed on Settings →
General — an admin who cannot redeploy cannot set a variable.

- **An install that had the variable is asked again**: no migration, no fallback, and
  **the gate cannot be dismissed**.
- **Nothing is lost while waiting.** A keyless `brand` task settles `SKIPPED` *before*
  anything marks the row `RUNNING`, and `settle` only overwrites `RUNNING` — so the
  company stays `PENDING`, which the sweep re-queues
  (`test/keyless-brand.integration.spec.ts`).
- **Saving the key runs the company sweep immediately** (fire-and-forget). Contacts wait
  for the next sign-in — only one of three portrait sources is Context.
- **`readContextDevKey` (`@crm/db/settings`) is the only reader**, read live with no
  cache. An unreadable database is a capability that is off, not an exception.
- **The key is never read back** — only whether one is set, and its last four.
- **The agent checks it, not the API** (a vendor client in the API is a bug):
  `settings.setResearchKey` calls `POST /internal/crm/verify-key` and writes unless the
  answer is *invalid*. **`401` is the only answer meaning the key is wrong.** **A check
  that cannot be made is not a failed check** — agent down or timeout → `unknown` →
  save anyway and log it unverified.

## Gmail and Calendar sync

Always on. Same OAuth client and callback — the two read-only scopes go on the existing
Google provider, so there is no extra redirect URI.

Scopes are requested at sign-in and gated by `requireGoogleAccess()`, because granular
consent lets a user untick one and still sign in. Missing either → `/grant-access`.

**An SSO rep is not gated** — `needsGoogleGrant` (`@crm/auth`) walls only an account
whose *sole* sign-in row is Google. It cannot be "has the scopes": an SSO rep has no
Google account to grant on, and `revoke()` keeps the `account` row, so trying the
optional feature and revoking would lock them out. They connect from **Settings →
Connections**, posting the same `linkSocial` call.

**Sync is forward-only.** Gmail records the current `historyId` on its first pass and
imports nothing; Calendar reads from `now`.

**`CRON_SECRET`** (min 16 chars) guards `POST /internal/sync/google` and
`POST /internal/sync/rates`; both **fail closed when unset**. **Crons live in
`apps/api/vercel.json`** — Google `*/5 * * * *`, rates daily. Minute-level schedules
need a Pro plan; on Hobby it silently becomes daily.

Deliberate absences: **no `GOOGLE_SYNC_ENABLED`** (a switch that can disable a mandatory
feature is only ever wrong), **no `GOOGLE_WORKSPACE_DOMAIN`** (`ALLOWED_SIGN_IN` already
says who is internal — two sources is how a colleague becomes a lead), **no
`GMAIL_BACKFILL_DAYS`**, **no rate provider variable** (`open.er-api.com` is a keyless
constant).

## Not env vars

- **Cache TTL** — `DEFAULT_TTL_MS` (60s) in `cache.module.ts`; `CACHE_TTL_MS` overrides.
- **Redis** — optional. Without `REDIS_URL` the cache is per-instance in-memory: fine
  locally, wrong for multi-instance.
- **Sign-in method** — Google is in code; an IdP is a row (SSO, in `api.md`).
