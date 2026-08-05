# Task: anonymous usage telemetry for trycompai/crm

Read `AGENTS.md` first and follow it. In particular: no code comments, one root `.env` with
`.env.example` as its documentation, anything a self-hoster might not have is optional and its
absence removes a capability rather than throwing, and no coauthored commits.

**Before writing any implementation code, write an ADR** at `adrs/telemetry.md` following the
format in `adrs/README.md`: what you want to change, why the current behaviour is a problem, what
you'd do instead and what it would break. Then stop and wait for review. `CONTRIBUTING.md` is
explicit that a paragraph someone wrote beats a PR full of generated code, and this is a change
where the reasoning matters more than the diff.

## Why

This repo is MIT and cloned rather than installed, so there is no download signal and no runtime
signal. We cannot tell which of the 20 agent tools earn their place, whether the evidence ledger
actually holds up in the wild, or where people give up during setup. We want anonymous,
aggregate usage data — enabled by default, trivially disabled, and auditable in one file.

## Non-negotiable constraints

1. **Server-side only.** `posthog-node` in `apps/api` and `apps/agent`. No `posthog-js`, no
   autocapture, no session replay, nothing in `apps/app`. Autocapture on a CRM would pull contact
   names, email addresses, company domains and deal amounts out of other people's databases. We
   do not want that data and would have to deal with it if we had it.

2. **The install ID lives in Postgres, not the filesystem.** All three processes deploy to Vercel
   with an ephemeral filesystem, so the usual `~/.app/telemetry-id` pattern would mint a new ID
   on every cold start. Add a table with a single row holding a UUID, created in a migration.
   All three processes read it. Never call `identify()`, never attach an email, never attach
   `ALLOWED_SIGN_IN`.

3. **Never instrument inside the sandbox.** `apps/agent/agent/sandbox` runs `deny-all` egress by
   design. A telemetry call in there will hang and then fail, and someone will spend a day
   debugging it. Emit from the agent runtime after the tool returns.

4. **Never block, never throw.** Fire-and-forget with a swallowed error handler. `posthog.on('error')`
   logs at debug and nothing else. A telemetry failure must be invisible to the user and must not
   surface in a request path or an agent session.

5. **Allowlist, not blocklist.** A single exported const listing every permitted property name.
   Anything not on the list is dropped before send, in code, not by convention.

## Opt-out

`CRM_TELEMETRY_DISABLED="1"` disables everything. Also honour `DO_NOT_TRACK=1`. Add both to
`.env.example` with a note, and declare `CRM_TELEMETRY_DISABLED` in
`apps/api/src/config/env.validation.ts` as optional.

When disabled, call `posthog.disable()` at init so every subsequent `capture()` is a silent no-op.
Do not scatter conditional guards through the codebase.

Add a **Settings → Telemetry** page under `apps/app/app/(app)/[slug]/settings/` matching the
existing pages there. It shows the current state, the exact JSON of the most recent payload, and
a link to `docs/telemetry.md`. Reading it should take thirty seconds and answer every question
someone would have.

## What to send

One `install_daily` rollup event per install per day, emitted from the API. Do **not** emit one
event per tool call — the agent runs continuously and it would be noise and volume for no extra
signal. Plus discrete events only for the setup funnel and errors, below.

Derive everything from the schema in `packages/db/prisma/schema.prisma`. Counts and enum
distributions only — never a value from a row.

### Install shape

- Install UUID, days since install, git commit or version
- Deployment target: `VERCEL` set or not, Node version, Postgres major version
- Capability booleans, mirroring `apps/agent/agent/lib/capabilities.ts` exactly: `RAPIDAPI_KEY`,
  `PERPLEXITY_API_KEY`, `CONTEXT_DEV` (the DB setting, not the key), `BLOB_READ_WRITE_TOKEN`.
  Extend with `GITHUB_TOKEN`, `REDIS_URL`, `AGENT_BRIDGE_SECRET`, `CRON_SECRET`,
  `AI_GATEWAY_API_KEY`, `IS_MARKETING`, whether Google OAuth is configured, whether an SSO
  provider row exists. Booleans only — never the values.
- Configured agent model id from `AppSetting.agentModelId`, and its context window
- Member count, bucketed

### The agent

This is the product, so it gets the most detail.

- Tool invocation counts keyed by tool name, from the 20 files in `apps/agent/agent/tools/`.
  The open question is which four do 90% of the work.
- Sessions started, sessions completed, mean tools per session
- `AgentTask` counts by `kind` from `TASK_KINDS` (`brand`, `portrait`, `meeting-prep`, `identify`,
  `profile`, `recheck`, `company-profile`, `workspace-profile`): claimed, completed, and retired.
  A task retired by `retireExhausted()` hit `MAX_ATTEMPTS` and the session never reported back —
  that is a pure failure signal and should be its own counter per kind.
- Mean and max `attempts` per kind
- Budget exhaustion rate: how often a session stops because the budget ran out rather than
  because it finished
- `schedule_recheck` calls, and the distribution of recheck intervals in day buckets
- Whether the sandbox is enabled, and `AgentConversation` count — how many installs actually
  configure `AGENT_BRIDGE_SECRET` and talk to the agent from the Agent tab

### The evidence ledger

The core product claim is that nothing about a person is guessed. Telemetry can test it.

- `ContactFact` counts by `status` (`APPLIED` / `PROPOSED` / `DISMISSED` / `SUPERSEDED`) and by
  `band` (`VERIFIED` / `PROBABLE` / `POSSIBLE`)
- The dismissal rate on `PROPOSED` facts — the share a human looked at and rejected. This is the
  agent's precision as measured by users rather than by us.
- Median time from `observedAt` to `decidedAt` — how long suggestions sit unsettled
- Counts by `method`, and by evidence kind from the `WEIGHTS` map in
  `apps/agent/agent/lib/evidence.ts`. We assert that `crm.signature-block` and `crm.thread-reply`
  are the best evidence and that they are free. Measure whether installs with no API keys at all
  actually produce applied facts.
- Facts superseded within N days of being applied — churn, meaning the agent changed its mind

### CRM usage

- `Contact`, `Company`, `Deal`, `Activity` counts, bucketed not exact
- `Contact` and `Company` counts by `RecordSource` (`MANUAL` / `IMPORT` / `EMAIL` / `CALENDAR`).
  The README claims most contacts arrive from the mailbox sync rather than being typed. This
  measures it.
- `Deal` counts by `DealStage`, to tell an install running a real pipeline from one only
  enriching contacts
- `Activity` counts by `ActivityType`
- Mailbox sync configured, last sync status from `MailboxSync`, threads and messages ingested in
  the period as counts
- `CompanyEnrichment` counts by `EnrichmentStatus`
- `SuppressedDomain` and `SuppressedContact` counts — people actively curating what the agent
  touches is a strong engagement signal
- Whether `WorkspaceProfile` has been written

### Setup funnel

Discrete one-shot events, each fired once per install. This is the number nobody else instruments
and probably the most valuable thing here.

`migrations_applied` → `first_sign_in` → `google_oauth_configured` → `first_mailbox_sync` →
`first_non_seed_contact` → `first_agent_task_claimed` → `first_agent_task_completed` →
`first_fact_applied`

Include a `seed_only` boolean on the daily rollup. `bun run db:seed` writes a known fixture set;
an install whose data is only seed rows is someone who ran it once, not a user. Without this the
numbers are meaningless.

### Errors

Error **class** plus the module or tool that threw. No messages, no stack traces, no payloads —
unlike n8n, which does send error messages, our errors will contain contact fields.

- Failed agent sessions by tool and error class
- Failed Google sync by error class
- API 5xx by route pattern and error class
- Model or AI Gateway failures by class

## What must never be sent

Grounded in the actual schema. Put this list in `docs/telemetry.md` verbatim.

- Any `Contact` or `User` name, email, title or photo
- Any `Company` name, domain, industry or location
- `ContactFact.value`, `.sourceUrl`, `.evidence`, `.field`
- `AgentTask.reason` and `AgentTask.outcome` — both free text the agent wrote about a named person
- `ContactBrief` content, `WorkspaceProfile.website`, `.narrative`, `.sections`
- `EmailThread` and `EmailMessage` subjects or bodies, `CalendarEvent` titles, `CalendarAttendee` rows
- `Deal` names and amounts. Stage distribution is fine; amounts are not.
- `AgentEvent.data`, `AgentConversation` content, prompts, completions, reasoning traces
- `ALLOWED_SIGN_IN`, `AppSetting.contextDevApiKey`, any key, secret, token or connection string
- `SuppressedDomain` and `SuppressedContact` values — counts only
- **IP address.** Set `$ip: null` and disable geoip. n8n collects IP and has to caveat their
  anonymity claim because of it. We do not need it and we would rather the claim be unqualified.

## Deliverables

1. `adrs/telemetry.md` — write this first, then stop for review
2. `packages/telemetry` — one module, allowlist const, install-ID accessor, disabled-check,
   typed event builders
3. A Prisma migration adding the install-ID table
4. Wiring in `apps/api` (daily rollup, funnel events, API errors) and `apps/agent` (tool counters,
   session outcomes, agent errors)
5. Settings → Telemetry page
6. `docs/telemetry.md` — every event, every property, in plain English, plus the never-sent list
7. `.env.example` entries and the `env.validation.ts` declaration
8. A README line in the env table matching the style of the existing rows
9. Tests: allowlist drops unknown properties, disabled flag produces zero network calls,
   `DO_NOT_TRACK` honoured, install ID stable across processes

## Notes

The PostHog project key (`phc_...`) is write-only and belongs in the committed `.env.example`
alongside a PostHog EU host. It is public by design.

Do not aggregate by querying every table on every request. The daily rollup should be one
scheduled job doing grouped counts, reusing the pattern in `apps/api/src/dashboard` where it fits.