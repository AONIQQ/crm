# Environment

One root `.env` is the only env file. Copy `.env.example` to `.env` and fill it
in. There are no per-app or per-package `.env` files.

## How it's loaded

`packages/db/src/env.ts` loads the root `.env` with `dotenv` (never overriding
vars already set in the real environment). Anything that imports `@trycompai/db`
(the API, the better-auth CLI, Prisma via `prisma.config.ts`) gets the root
`.env` from any cwd. `apps/app/next.config.ts` loads it too, so `NEXT_PUBLIC_*`
are inlined at build time.

## Typed, validated env (no scattered `process.env`)

Application config is read through a zod-validated `env` object per app/package,
not via ad-hoc `process.env.X` reads. Each validated module fails fast at first
use with a message naming the bad var:

- `packages/auth/src/env.ts` — Stripe secret/webhook, `REDIS_URL`, better-auth
  URLs/origins, `CONTEXT_DEV_API_KEY`
- `packages/email/src/env.ts` — `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_APP_URL`
- `apps/api/src/env.ts` — all API secrets/deployment values
- `apps/app/lib/env.ts` — `API_URL`, `NEXT_PUBLIC_POSTHOG_*`

Deliberate exceptions (do NOT add new ad-hoc reads outside these):

- `packages/db/src/env.ts` is the dotenv loader only (side-effect import); it must
  not validate/throw, so `import "@trycompai/db/env"` stays safe for test files
  that compute a skip condition before touching the DB. `DATABASE_URL` is
  validated in `client.ts` where the Prisma client is built.
- `NODE_ENV` is read live via `process.env.NODE_ENV` (not a frozen `env` object)
  in `apps/api/src/logging/context-logger.ts` and `packages/db/src/client.ts` — it
  is a platform var and must be runtime-togglable (e.g. the logger test sets it).
- `packages/tracking/src/config.ts` reads `process.env` lazily at call time: the
  package is imported into Next client bundles (can't pull in `@trycompai/db/env`
  → `node:fs`) and is imported before dotenv loads, so a parse-at-import `env`
  object would capture empty values.

turbo runs in strict env mode; each cached task declares its `env` keys and `.env`
is a task input so caching invalidates correctly.

## What is NOT an env var (by design)

- **Stripe catalog** (meter event names, per-unit prices, free-seat counts, seat
  amounts, price `lookup_key`s) lives in `packages/auth/src/billing.config.ts`.
  `unitPriceCents` MUST equal the Stripe metered price's `unit_amount_decimal`.
  `stripe:setup` creates and verifies against the catalog — it throws on a metered
  unit-price mismatch (including a `null` unit amount) and on a reused seat price
  whose graduated tiers (free-seat boundary or per-seat amount) drift from config.
- **Stripe price IDs** are resolved at boot from Stripe by `lookup_key` and cached
  in memory (`packages/auth/src/stripe-prices.ts`) — never stored in env.
- **Log format/level** default off `NODE_ENV` (json + log-level in prod, pretty +
  all-levels in dev).
- **AI model/gateway URL**: the gateway base URL and default model
  (`DEFAULT_CODE_SECURITY_MODEL`) are code constants
  (`code-security/shared/contracts.ts`);
  the Vercel AI Gateway (`AI_GATEWAY_API_KEY`) is the single AI path. The per-org
  model override lives in the DB (`OrganizationModelConfig`, set in **general
  workspace settings**) and applies to **every AI call in the app** — code
  security scans/reviews, cluster/promote/triage, cloud remediation, and pentest —
  via `resolveModel()` in `apps/api/src/ai/model.ts` (default `DEFAULT_AI_MODEL`).
  The **selectable model list + per-model billing rates are fetched
  live from the gateway `/v1/models` endpoint** (`billing/model-pricing.ts`,
  cached in memory) — not env, not a hardcoded list.

## Stripe setup

Create/verify meters, metered prices, and graduated seat prices (with stable
lookup keys) in the target Stripe account:

```
bun run --filter @trycompai/stripe-dev stripe:setup
```

Nothing to paste into `.env` — price IDs resolve via lookup key at boot. Run this
against prod Stripe before deploying, or the People plan won't be offered. (The
`mdm_device_v1` IT Security price is no longer created — that module was retired
into People on 2026-07-27; archive the existing Stripe price rather than deleting
it.)

## Database migrations

**Migrations apply themselves on deploy.** The `buildCommand` in
`apps/app/vercel.json` runs `bun run vercel-build`, which is:

```
prisma generate  →  db:deploy  →  trpc codegen  →  next build
```

The history is a single squashed `20260726140000_init` migration. Every
environment has been baselined onto it, so `migrate deploy` is a no-op until the
next migration is added. Add new migrations with `db:migrate` as normal.

**Migrations must not run through the connection pooler.** `DATABASE_URL` points
at Neon's `-pooler` host (PgBouncer, transaction pooling). That is correct for
the app, but DDL and anything session-scoped must use the direct host — drop
`-pooler` from the hostname. Session-level advisory locks in particular are
silently broken through the pooler: the lock is stranded on an arbitrary backend
and the matching unlock lands on a different one, so it is never released and
every later connection waiting on it blocks forever.

## Admin access (bootstrap)

The database `admin` role is the only admin path (there is no `ADMIN_USER_IDS`
env). To grant the first admin, set the role directly:

```sql
UPDATE "user" SET role = 'admin' WHERE email = 'you@example.com';
```

After that, promote others from the in-app admin panel.

## Advanced / rarely set (not in `.env.example`)

- `PENTEST_AGENT_DIST` — override path to the built pentest agent
  (`packages/pentest/dist`); auto-discovered otherwise.
- `BUN_BIN` — bun binary path for `apps/api/scripts/build-func.mjs` (default
  `bun`); a build-tool override, not app config.
- `VERCEL`, `NODE_ENV`, `CI` — set by the platform; turbo passes them through.

## Pentest traffic enforcement

Production pentest runs require `REDIS_URL` and `PENTEST_PROXY_BASE_URL` in
addition to the sandbox and Blob variables in `.env.example`.
`PENTEST_PROXY_BASE_URL` is the public HTTPS origin of the API deployment. The
Vercel Sandbox firewall forwards every in-scope HTTPS request to the run-scoped
proxy endpoint at that origin. Redis provides the shared organization, run,
host, and route counters plus the temporary redacted traffic ledger. Runs fail
closed when either dependency is absent.

Vercel Sandbox request forwarding must be enabled for the project plan. HTTP
targets are rejected because the managed firewall forwarding path is HTTPS-only.

`PENTEST_ARTIFACT_RETENTION_DAYS` optionally enforces a 1–3650 day private
artifact retention window through the signed artifact manifest. When unset,
retention remains `not-configured`.

## Cloud Security connectors (keyless customer onboarding)

Both Google connectors are keyless for the customer — nobody creates or downloads
a service-account key on the customer side, so they work under Google's
secure-by-default `constraints/iam.disableServiceAccountKeyCreation` org policy.
The trust model mirrors AWS: a single Comp AI-owned identity, granted access from
the customer side, mints short-lived credentials per scan.

- **AWS** — `AWS_CONNECTOR_ACCESS_KEY_ID` / `AWS_CONNECTOR_SECRET_ACCESS_KEY`
  (optional `AWS_CONNECTOR_SESSION_TOKEN`, `AWS_CONNECTOR_REGION`). The customer
  creates an IAM role trusting this account with `sts:ExternalId` = their org id;
  the API `AssumeRole`s it per scan.
- **GCP + Google Workspace** — `GCP_CONNECTOR_SA_KEY` (the JSON key of Comp AI's
  own connector service account). For **GCP**, the customer creates a read-only
  auditor SA (no key) and grants the connector SA
  `roles/iam.serviceAccountTokenCreator` on it; the API impersonates it to mint
  short-lived tokens per scan. For **Workspace**, the customer authorizes the
  connector SA's OAuth client ID for domain-wide delegation and the connector
  impersonates a delegated admin. The connector SA's email and OAuth client ID
  are derived from the key and surfaced to the onboarding UI via
  `GET /api/cloud-security/gcp-connector` (and, for People, the
  `peopleConnections.googleConnector` tRPC query). Set up the connector SA once
  in Comp AI's own GCP project (where key creation is allowed); enabling
  `iamcredentials.googleapis.com` on the customer project is part of the
  onboarding script.

## One Google Workspace delegation, shared by People and Cloud Security

Both modules connect to the same Workspace tenant through **one** domain-wide
delegation grant. Whichever module's setup wizard the customer completes first
activates both: `WorkspaceConnectionService.activate`
(`apps/api/src/integrations/google-workspace/workspace-connection.service.ts`)
writes the shared `google_workspace_connection` row plus the
`people_provider_connection` row, and the caller links its own
`cloud_connection`. Because the delegation is shared, neither module's layout
gate sends the customer back to a setup wizard once either has been run.

- **Scopes** live in `apps/api/src/integrations/google-workspace/scopes.ts` and
  nowhere else. The customer authorizes `WORKSPACE_ALL_SCOPES` (read **and**
  write). Both Cloud Security and People request `WORKSPACE_READ_SCOPES` — the
  same six read-only scopes Cloud Security always requested, unchanged, so
  existing grants keep working. `WORKSPACE_DIRECTORY_SCOPES` (write) is still
  probed at activation to record `writeAccessGranted`, but nothing requests a
  write token today; People reads the directory and never writes to it.
  Both the `.readonly` and the write variant of a scope must be in the grant:
  domain-wide delegation matches scope strings exactly, so a grant holding only
  `admin.directory.user` rejects a request for `admin.directory.user.readonly`.
- **Cloud Security must never request write scopes.** `mintDelegatedAccessToken`
  asserts it for `purpose: "read"`, and
  `apps/api/test/google-workspace-delegation.spec.ts` fails if any file under
  `apps/api/src/cloud-security/` so much as mentions a write scope or
  `purpose: "write"`.
- **Known residual risk:** the scan pipeline writes the connector SA's raw
  private key into the Vercel Sandbox for Prowler
  (`scan-pipeline.service.ts`, `google_workspace` case). Because the grant now
  includes write scopes, that sandbox credential *could* mint a write-scoped
  token — the read-only guarantee is enforced in our code, not by the grant. The
  fix, if this becomes unacceptable, is a second read-only connector SA whose
  client ID is authorized for the read scopes only; the scope-selection seam
  (`scopesForPurpose`) is where that would plug in.
- **Domain-wide delegation is the only credential path.** There is no stored
  secret: every call mints a short-lived token from the shared delegation. The
  old "sign in with a Google super admin" OAuth mode (refresh token in
  `people_provider_connection.encryptedPayload`) and its backfill script were
  removed along with the rest of the People module; `credentialMode`,
  `encryptedPayload`, `scheme`, and `tokenExpiresAt` are gone from the table.
- **Re-authorization.** A delegation refused with `unauthorized_client` /
  `access_denied` flips the shared row to `status = "scopes_outdated"` and
  `writeAccessGranted = false`, and degrades the People connection; the People
  setup wizard is where the customer re-authorizes.

Note: customer org policies that restrict cross-org IAM members
(`constraints/iam.allowedPolicyMemberDomains`, domain-restricted sharing) can
block granting the connector SA on the customer project — this is inherent to any
cross-org GCP access model and is surfaced as a connect error.
