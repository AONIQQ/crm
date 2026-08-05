# API Rules

## Logging

`apps/api/src/logging`. `new Logger(Thing.name)` picks up `ContextLogger`. **Never
`console.log`.** Format follows `NODE_ENV` and is not configurable.

- **One object, not extra arguments** — `logger.log({ message: "Saved", userId })`;
  Nest prints a line per argument.
- **Errors pass the stack second** — `logger.error({ message }, err.stack)`. Passing
  the error object drops the trace.
- **Never log headers, query strings, or bodies** — cookies and personal data.
- **`LoggingModule` stays first in `AppModule`'s imports**, and Better Auth routes log
  via its own `middleware` option — it mounts before `MiddlewareConsumer`, so
  `/api/auth/*` never reaches ours.
- `requestId` from `RequestLoggerMiddleware` via `AsyncLocalStorage`;
  `UserContextInterceptor` adds `userId`. Prisma statements are opt-in
  (`PRISMA_LOG_QUERIES`).

## Intelligence never lives in the API

The API serves HTTP, auth, tRPC and the Google sync. It does **not** research, enrich,
score, summarise, match identities or decide anything about a person or company — not
as a fallback, not behind a flag. That is the eve agent in `apps/agent`, which owns
the vendor clients, the confidence model and the writes.

Nest's half is to report *that something happened*: `AgentTriggerService` writes an
`AgentTask` row. A row, not an HTTP call — the agent already leases from that table,
so the row survives the agent being down.

About to add a vendor client to `apps/api`? You want `apps/agent/agent/lib`. One
documented exception, for timing: the exchange-rate fetcher, below.

## One organization, and it is not a tenancy boundary

Single tenant. No org header, no org interceptor, no org-scoped cache keys, **no
`organizationId` on any CRM record.**

A **singleton workspace** exists — Better Auth's `organization` plugin, one row with
id `WORKSPACE_ID` (the literal `workspace`, in `@crm/db`, re-exported by `@crm/auth`
so the agent needn't depend on it). It answers only: what are we called, who works
here, what do we sell.

- **The id is a constant, never a parameter.** A function taking an `organizationId`
  has turned the plugin into tenancy plumbing.
- **Signing in is the join; no invite flow.** `ensureWorkspaceMembership` runs in
  `databaseHooks.session.create.before` and **degrades, never throws** — a throw fails
  the session create and locks everyone out. The plugin's `invitation` table is unused.
- **First account is owner**, and the hook enrols pre-existing users, oldest first.
- **Permissions come from `@crm/auth`** — `canRenameWorkspace`, `canChangeRole`,
  `canConfigureSso`, `canManageCurrency` — enforced by the service *and* used to
  disable the UI control, so the button and the 403 cannot disagree.
  `WorkspaceService` adds one invariant: **the last owner cannot be demoted**, with
  `FOR UPDATE` on the owner rows before counting.
- **Reads and writes go through tRPC**, not `authClient.organization.*`.
- **Name and website are required at onboarding and cannot be skipped**, in the form
  *and* in `updateWorkspaceInput`, posting the same `workspace.update` as settings.
- **Onboarded state is `onboardedAt` inside the plugin's `metadata` blob**, not a
  column; `isOnboarded`/`markOnboarded` (`@crm/db/workspace`) are the only accessors,
  and `markOnboarded` preserves every other key.
- **The name starts as `DEFAULT_WORKSPACE_NAME` (`CRM`), a placeholder not an
  answer.** The header renders `<name> CRM`, so `workspaceLabel` tests the name rather
  than comparing to the default.
- **The website queues the agent's `workspace-profile` task** and goes through
  `normalizeDomain`, rejecting null. Stored canonical, so re-saving uncanonically
  counts as a change and re-queues research.

### Gates in `proxy.ts`

Onboarding, then `/onboarding/research` for the Context key. Asked server-side every
request.

- **`getSessionCookie()` decides signed-in**; pages still resolve the real session via
  `requireGoogleAccess()`.
- **Nothing is cached in a cookie** — both facts revert on a database reset while a
  year-long marker insists the gate passed. Cache in the API if cost ever matters.
- **Both reads run concurrently**, but order decides which is *asked* — the research
  read is never made while onboarding is open.
- **An unreachable API fails open** (`unknown` lets the request through).
- **`/sign-in`, `/grant-access`, `/eve` are ungated.** `/sign-in` is the only path a
  stranger may read; `/` joins it only when `IS_MARKETING` is set.
- **There is no way past the key gate but to answer** — Skip stranded installs, every
  later company sitting `PENDING` with nothing saying so.

### The name is also the URL

Served under the workspace slug (`/comp-ai/companies`). **Cosmetic, not tenancy** —
every query still resolves through `WORKSPACE_ID`.

- **The slug is the plugin's column**, written by `workspaceSlug(name)`
  (`@crm/db/workspace`) on rename and create. **Never derive it on read.**
- `ensureWorkspaceMembership` reconciles it; `RESERVED_SLUGS` prevents collision with
  a real route (a collision gets `-crm`).
- **The proxy is the only thing that puts the slug on.** Missing or stale slugs are
  redirected with the query string intact, not 404'd; `[slug]/layout.tsx` is the
  backstop.
- `appPath` in `proxy.ts` is the one place `/` resolves for a signed-in rep, which
  keeps every `callbackURL` correct without knowing about slugs.
- **Renaming moves the URL**, so `workspace-form.tsx` replaces the location onto the
  slug `workspace.update` returns.

## SSO is a row, not a deployment

An `ssoProvider` row via Better Auth's `sso` plugin, on Settings → SSO, because a
self-hoster's admin cannot redeploy.

- **OpenID Connect only** — issuer, client id, secret; endpoints from discovery. No
  SAML UI: it needs an X.509 cert and SP signing key we have nowhere to keep.
- `SsoService` passes `WORKSPACE_ID`, never an input.
- **Management is tRPC (`sso.*`); signing in is `authClient.signIn.sso()`.**
- **`sso.signInOptions` is the one public procedure in the app.** Every other `sso.*`
  takes `AuthMiddleware` at the *method*, which is what leaves it open. A client
  secret is never read back out.
- **It is the API's answer, not the app's** — the API serves `/api/auth/*`.
- **An install with neither Google nor a provider says so**, naming the two variables;
  a read that *fails* falls back to offering Google.
- **A provider hides the Google button, it does not disable it** —
  `/sign-in?method=google` still works, so a mistyped issuer cannot lock an admin out.
- **Signing in with an IdP does not cost you Gmail.** `needsGoogleGrant` (`@crm/auth`)
  walls only an account whose sole sign-in row is Google.
- `ALLOWED_SIGN_IN` still decides who gets an account, in
  `databaseHooks.user.create.before`, for SSO sign-ups too.
- `organizationProvisioning: { disabled: true }` — `ensureWorkspaceMembership` already
  does the join.

## tRPC is the data surface; REST is auth and health only

- **One router per module**, `*.router.ts` (the codegen glob), with
  `@Router({ alias })` and `@UseMiddlewares(AuthMiddleware)`. **No `AuthMiddleware`
  means public — there is no other guard.**
- **Routers are thin**: zod in, service call out; Prisma lives in `*.service.ts`.
- Services throw Nest's `HttpException` family; `DomainErrorMiddleware` maps them.
- **Filter, sort and paginate in Prisma.** List procedures take `listInput` and return
  `{ rows, total, facetCounts }`. Never filter a whole table in the browser; never
  interpolate `sort` into a field name — use `resolveOrderBy`.
- **`src/generated/server.ts` is generated *and committed*, and `build` must never
  regenerate it** — the generator needs GLIBC 2.39, newer than Vercel's build image.
  Only `check-types` and `dev` run it. If the app cannot see a new procedure, it has
  not run.

## Not every address on a thread is a person

`externalParticipants` (`google/participants.ts`) is the one gate, discarding **us**
(allow-list domains, `User` table), **rep decisions** (`SuppressedContact`,
`SuppressedDomain`), and **addresses no human reads**.

- **`isMachineDomain` (`companies/domain.ts`) sits beside `FREE_EMAIL_DOMAINS`**;
  `domainFromEmail` returns null for both, and `companyForEmail` is the only path from
  address to company — so a caller ignorant of the rule still cannot create one.
  `.calendar.google.com` covers shared calendars, rooms and ICS feeds.
- **Matches the host, never a substring** — `calendar.acme.com` is a real company.
- **`isMachineAddress` also catches opaque local parts** (24 hex chars, UUIDs),
  deliberately narrow: a false positive is a real customer never filed.
- **It leaves no row** — a rep may still type these into quick-add; only the *inbox*
  is barred from deciding. `syncAttendees` filters the same addresses beside
  `attendee.resource`.
- **`isAutomatedAddress` is a separate list about the local part** (`sales@`,
  `noreply@`), which is why `support@acme.com` never becomes a lead.

## Deleting a record

`contacts.delete`, `companies.delete`, `deals.delete`. No soft delete, no archive.

- **A deleted contact is suppressed by address**, or the sync recreates them from the
  next thread. `ContactsService.delete` writes `SuppressedContact`, and
  `externalParticipants` drops it like a `SuppressedDomain` — one filter covering
  contact creation, company auto-creation and attribution.
- **Keyed lower case.** `normalizeEmail` (`crm/values.ts`) is the one canonicaliser,
  on `contacts.create`, `.update` and the suppression; conflict checks and `allowAgain`
  match case-insensitively.
- **The address comes from the delete itself**
  (`tx.contact.delete({ select: { email: true } })`), not a read before it — and the
  404 is that statement's own `P2025` through `translate`.
- **Adding them back lifts the suppression** via `allowAgain` **inside the write's
  transaction**. Never automatic.
- **Deleting a company does not suppress its domain** — its people survive with no
  company, and domain suppression stays the explicit Settings → Connections control.
- **Clear `AgentTask` and `AgentEvent` yourself** — they carry `contactId`/`companyId`
  with no foreign key, so nothing cascades.
- **Recompute `lastActivityAt` on exactly the records the delete reached.**
  `ActivityStampService.targetsOf(where)` collects them *inside* the transaction (the
  evidence is what gets deleted); `recomputeMany` restamps. A company's `where` must
  follow its deals: `{ OR: [{ companyId }, { deal: { companyId } }] }`.
  `recomputeAll()` is for a purge only.
- **Recompute after commit, logging rather than throwing** — the row is already gone,
  and a raised error makes the browser skip invalidation and retry into a 404.

## A deal is sold in one currency and reported in another

Two amounts, and only one is ever summed. (`_sum: { amount: true }` once added euros
to dollars and printed `$2.0M`, silently.)

- **`amount` + `currency`** is what the customer pays. Never converted in place.
- **`baseAmount` is the only column any total, chart, average or sort may touch**;
  `fxRate`/`fxRateAt` record how it got there.
- **`baseCurrency` says what `baseAmount` is denominated in** — without it a figure
  converted against a stale base is indistinguishable from a correct one.
  - **`countedWhere(base)` filters every money aggregate.** Counts are deliberately
    *not* filtered, so stage groups read counts and sums from separate queries.
  - **`pendingWhere(base)`** = null `baseAmount` *or* wrong `baseCurrency`, and it
    **matches null explicitly** — `{ not: base }` is `NULL`, not true, for a null
    column, so such rows were invisible everywhere.
  - **Compose with `AND`, never spread** — it contains an `OR`, and so does the deals
    list's own `where`.
  - **Every writer of `baseAmount` writes `baseCurrency` in the same statement**:
    `ConversionService` and `prisma/seed.ts`.
- **The rate is resolved once and frozen.** `create`/`update` call
  `ConversionService.dealFields` when `amount` *or* `currency` changes, reading the
  unchanged one back in the same call. Converting on read makes a closed quarter change
  value every morning.
- **A missing rate is a null, disclosed not zeroed** — it falls out of `_sum`
  automatically, and `unconverted` counts those rows so the UI can say *3 deals in CHF
  are not included*.
- **`fillMissing()` never touches a converted deal**; `rerateAll()` is the only thing
  that overwrites a frozen rate, and only on a reporting-currency change.

**`ExchangeRate.rate` = units of `baseCurrency` per unit of `quoteCurrency`**, so
`baseAmount = amount × rate` everywhere. The feed quotes the other way; `RatesService`
inverts on ingest.

- **`MANUAL` beats `FETCHED`** (unique on `(base, quote, source)`), which makes the
  fetcher optional — Settings → Currencies is the manual path. `resolveRate` refuses a
  rate ≤ 0.
- **Re-rating deduplicates codes through a `Set`** — `currency` was free text, so
  ` usd ` and `USD` were two groups each updating every variant.
- **`MAX_AMOUNT_CENTS`** (`deals.contracts.ts`) is what `Decimal(14, 2)` holds;
  `baseAmount` is `Decimal(24, 4)` so amount × rate still fits.
- **Reporting currency is `AppSetting.reportingCurrency`**, read only through
  `readReportingCurrency`.
- **Codes are validated against `isCurrencyCode` (`@crm/db/currency`), not a regex** —
  `z.string().length(3)` accepted `ZZZ`. `isWellFormedCurrency` is separate because
  `Intl` throws on non-three-letter input.
- **`CURRENCIES` is ten currencies and that is all this CRM supports** — USD, EUR, JPY,
  GBP, CNY, AUD, CAD, CHF, HKD, SGD, in array order. `isCurrencyCode` is the single
  gate for the picker, the feed filter and the stored setting. A refresh **prunes**
  `FETCHED` rows outside the ten and leaves `MANUAL` alone.
- **`applyRate` rounds to the *reporting* currency's `minorUnitsOf`**, not to two. The
  ×100 cents transport cannot represent a three-decimal minor unit; nor can
  `Decimal(14, 2)`.

**Feed: `open.er-api.com`, keyless**, two attempts at 6s. **Check `result`, not just
the status** — an unsupported base returns HTTP 200 with `{"result":"error"}`. An
unreachable provider warns and returns `{ ok: false }`; only the interactive refresh
throws.

**The fetcher is in the API deliberately**: a daily rate decides nothing, and
`DealsService` needs it *synchronously* to write `baseAmount` in the same transaction.
Any judgement about it belongs in `apps/agent`.

`POST /internal/sync/rates` is guarded by `CRON_SECRET` (`timingSafeEquals`) and
**fails closed when unset**. **A route is not a schedule** — add it to
`apps/api/vercel.json` in the same change or nothing runs it.

## Freshness: invalidate the query, don't disable the cache

- **Invalidate in `onSuccess` through `useCrmCache()`** (`lib/trpc/cache.ts`), never by
  listing keys at the call site. Say what changed — `cache.deal(id)`,
  `cache.company(id)`, `cache.contact(id)`, `cache.activity()`. **A new mutation adds a
  call there, not a new list of keys.**
- **A deletion is `cache.removed(ref)`** — one wide fan-out, and the only place
  `refetchType: "none"` is right: the deleted record's `byId` query is still mounted
  while the sheet animates shut, so refetching reads a 404 into the closing sheet,
  while leaving it alone serves 30s of a dead record from cache.
- **`{ settle: "record" }`** for inline editors, so the field's spinner clears without
  waiting for the table.
- **Infinite queries need `pathKey()`, not `queryKey()`** — the latter stamps
  `{ type: "query" }` and silently cannot match `{ type: "infinite" }`.
  `activities.timeline` is read both ways.
- **`cache-manager` is per-value and opt-in**, not an interceptor;
  `AuthService.getProfile` is the model.
- **Background writes need polling, not invalidation** — `refetchInterval` while
  `PENDING`/`RUNNING`, via `isEnriching()` and `ENRICHMENT_POLL_MS`. **Lists poll too,
  not just the sheet.**
