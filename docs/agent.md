# Agent — `apps/agent`

An [eve](https://eve.dev/docs) app, its **own deployment**, owning every piece of
intelligence in this repo. Read with `api.md`, whose first rule is that none of this
may move into the API. Local dev, the bridge env vars and the manual dispatch command
are in `docs/setup.md`.

**Read the eve guide before writing eve code** —
`apps/agent/node_modules/eve/docs/README.md` matches the installed version;
`.agents/skills/eve` is the skill. Guessing typechecks, builds, then misbehaves.

## Model

Default `zai/glm-5.2-fast`; `DEFAULT_AGENT_MODEL` in `@crm/db/settings` because the
agent and the API both need it.

- **A row (`AppSetting`), not an env var**, via `defineDynamic` on `session.started`.
  Open conversations keep their model — prompt caches are per model.
- **`lib/model.ts` always sends `modelContextWindowTokens`**; eve never inherits it.
- **A failed read logs and keeps the compiled fallback.** Never throws.
- **The chooser offers only `tool-use` models** (`ModelCatalogService`).
- **Not a frontier model, deliberately** — refusing wrong answers is enforced by the
  tools and evidence model, not model strength.

## Pictures are copied, never linked

`mirror()` copies bytes to Vercel Blob; the record points at our copy. Lives in
**`@crm/db/blob`** — writers are `lib/brand-images.ts`, `lib/portrait.ts`,
`FaviconService`, `ImageMirrorService`, `prisma/seed.ts`.

- **The key hashes the bytes** — idempotent, and a redesigned mark gets a new URL.
- **`COMPANY_IMAGE_FIELDS` (`@crm/db/images`) is the one list of picture columns.**
- **Fetch through `@crm/db/safe-fetch`** — vendor URLs are SSRF vectors.
- **No `BLOB_READ_WRITE_TOKEN` means no photographs**; logos keep the origin URL.
- **`isOptimizable` (`@crm/db/images`) is the whole rule**: `next.config.ts`
  allow-lists only our Blob host (a wildcard makes us an open image proxy), and a
  mirrored **SVG is still refused**.
- **Faces are not optimized** — `AvatarImage` skips `<Image>` because Radix probes the
  URL itself, doubling fetches.
- **A photograph only comes from a source already tied to this person** —
  `lib/portrait-sources.ts`: their LinkedIn, their GitHub, their employer's team page,
  each keyed on an identifier already on the record.
- **There is no image search by name, and there must never be.** Nobody audits a face.
  **Guess where to look, never what you will find.**

## Two lanes

`schedules/dispatch.ts`, split by `DIRECT_KINDS` in `@crm/db/agent-tasks`.

| | Kinds | How | Per tick |
| --- | --- | --- | --- |
| **Visible** | `brand`, `portrait` | Directly — no `receive`, no model | 60, six at a time |
| **Research** | everything else | One eve session per row | 12 |

**Neither visible kind has anything to decide**, and through a session they queued
behind sixty LLM runs for 25 minutes (`test/lanes.integration.spec.ts`). **The row says
what the work is; the lane only says whether it needs a conversation.**

**Priority**: `brand` 900 · `portrait` 800 · `workspace` 500 · `requested` 300 ·
`meeting` 200 · `identify` 100 · `sweep` 50 · `companyProfile` 40 · `recheck` 0. The
top two are what a rep reads *before* deciding what to open.

**`claimDue` sorts what it claims** — Postgres does not order `UPDATE … RETURNING` by
its sub-select's `ORDER BY`.

### Dispatch on demand

`POST /internal/crm/dispatch` drains **both lanes**; `AgentTriggerService.poke()` calls
it after writing any `AgentTask`.

- **Fire-and-forget, never awaited** — the row is still the message.
- **Both lanes.** Visible-only made them diverge under `eve dev`, where there is no
  cron: logos resolved instantly while `identify` sat at `attempts = 0` forever.
- **Calls the channel's own `send`, not `receive`** — it is already on the crm channel.
  Principal from `APP_AUTH` (`lib/app-auth.ts`); `taskAuth()` keeps schedule and route
  from drifting.
- **`drainAll` collapses** via `collapsing()` (`lib/pool.ts`) — forty new contacts poke
  forty times, and `claimDue` hands each a disjoint batch. Per-process; cross-process
  overlap is leases and `FOR UPDATE SKIP LOCKED`.
- **`AGENT_BRIDGE_SECRET` unset refuses rather than opens.**

### `POST /internal/crm/verify-key`

Probes a candidate Context key → `valid`/`invalid`/`unknown`. No session, no model, no
task row; exists because the API may not call Context.

- **The probe is free and chosen to be** — a free-provider address gets a `422` before
  billable resolution. **Do not point it at a real domain**: ten credits per typo.
- **`classifyKey` rejects on `401` and nothing else.**
- **The candidate key, never the stored one.**

### Backfills

Sign-in sweep covers records never looked up (10 credits/company);
`ImageMirrorService` in the same sweep re-hosts off-site pictures (free);
`backfill:images` fixes enriched records missing only pictures (free).

- **The image sweep keeps "every picture is ours" true**, not true-since-Tuesday.
  25 rows/table/sweep.
- **A finished `portrait` task stands that contact down for thirty days** — that third
  source costs credits and usually finds nothing.
- **No button, deliberately** — a rep cannot know which records predate a resolver.
- **The trigger is signing in**, via `databaseHooks.session.create.after` in
  `packages/auth`; `BackfillService` subscribes with `onSignedIn` and has no router
  (`@crm/auth` must not import a Nest provider). Five-minute stand-down, and `auto()`
  returns before work starts.
- **The 500-row cap is on the pass, not each query in it.** Deduplicate the union, cut
  to 500, count `remaining` against the union.

## Evidence, not confidence

**No tool accepts a confidence, a score, or a `sourceUrl` offered as proof.** Tools
report what they *observed* (`crm.signature-block`, `github.account-identity`) and
`lib/evidence.ts` prices it. A model asked to grade its own certainty will, and will be
wrong in the direction that looks useful.

- **`lib/facts.ts` is the only write path to a contact's fields.** Applies at
  `VERIFIED`, proposes below it, and enforces three things a prompt cannot: never
  overwrite a human, never re-offer a dismissal, never write without a primary source.
- **Bands are behaviour.** `PROBABLE` means *a rep decides* — a correct outcome.
- **A new fact field goes in `FIELDS` (`lib/facts.ts`) *and* `FACT_COLUMNS`**
  (`apps/api/src/contacts/contacts.service.ts`).

## Optional by default

`lib/capabilities.ts` is the single place that knows what is set: prints it at boot,
states it in the session instructions, and gives tools a shared "not configured,
retrying will not help" result — **checked before the research budget is charged**. A
missing key removes a place to look. **Never an error, never throws.**

**`capabilities()` is async** because the Context key is a row;
`capabilitiesFrom()`/`markdownFor()` are the pure halves. `contextDevKey()` is the only
resolver, and `lib/context-dev.ts` memoises its client on the key string.

## Budget and scheduling

- `lib/focus.ts` — per-session budget in `defineState`; running out is a normal ending.
- `lib/tasks.ts` — `claimDue` leases with `FOR UPDATE SKIP LOCKED`.
- **`schedules/dispatch.ts` is the only schedule and decides nothing.** "Every N
  minutes, the oldest ten contacts" belongs in a `dueAt`.
- `tools/schedule_recheck.ts` — its `reason` is shown to the rep.

## Three records, no dead ends

**Every read hands back the ids of neighbouring records.** Breaking this made the agent
ask a rep who had a company open, contacts on screen, to paste an email.

| Read (all free) | Hands back |
| --- | --- |
| `read_crm_history` | the contact's **company id**, their deals, their colleagues |
| `read_company_history` | **every contact with id**, deals, threads, meetings, notes |
| `read_deal_history` | stage clock and history, **people with ids**, last reply |
| `search_crm` | contacts, companies and deals matching typed text |

**A preamble or tool result naming a record without its id is a bug** — the only
recovery is asking the human. Ambiguity is fine: four Marchettis is four rows with
titles. **`search_crm` does no fuzzy matching** — "Marchetti" reaching "Marchetta" is a
wrong record about a real person.

### Preambles

`lib/preamble.ts` varies on **which record** (each names its neighbours with ids and
points at the read to start from) and **who opened it** — a dispatched task is a
research pass with a budget, a rep in the sheet is a conversation. Told neither, the
agent answered a question with a work plan. `taskKind` is the tell.

`task.ts` is the resolver and owns one side effect: seeding `lib/focus.ts`, without
which the audit hook files events against nothing.

**A fourth record kind** = `sessionPreamble` entry + a read + a `TOOL_VERBS` line
(`apps/app/lib/agent-transcript.ts`) + a `COPY` entry (`lib/agent-record.ts`).

### Every session knows who *we* are

`composeClosing()` puts a **Who we are** block before the capabilities in every
preamble; `lib/workspace.ts` is the only renderer.

- **Tiny, enforced by the write path** — `MAX_NARRATIVE` (320) and `MAX_LINE` in
  `@crm/db/workspace`. It is prompt-cached and precedes every question.
- **It says what the context is for** — fit, competitor, partner, or nothing — and
  **never a pitch**, or the model sells our own product back to us.
- **No profile still gets the name line**, plus *do not guess at what we sell*.
- **The profile dies with its website** — `readWorkspaceIdentity` returns it only while
  `website` matches.
- **Not a `Company` row** — that needs excluding from every list, facet and join. One
  `WorkspaceProfile` keyed on `WORKSPACE_ID`.

The pass is a `workspace-profile` task using `web_fetch` (no credits), filed only via
`write_workspace_profile`, queued by `WorkspaceService.update` on a website change. **A
finished attempt stands the sweep down for seven days.**

## What may be read, and what may leave

It may read **everything**, including full email bodies — internal single-tenant tool,
and a signature block is the best source of a job title there is. The boundary is
egress:

1. No customer text in a third-party query. Derived questions only.
2. Nothing from a mailbox into `/workspace` — different lifetime.
3. Nothing sensitive logged. Reading is not logging.

`skills/data-boundaries.md` is the agent's copy. Keep them in step.

## Sandbox

`agent/sandbox/sandbox.ts`: `bash`, file tools, `/workspace`, **`deny-all` egress on
the backend factory** so it cannot be forgotten per session. Costs nothing —
`web_fetch` runs in the app runtime, `web_search` at the provider.

**Never give the sandbox `DATABASE_URL`.** CRM access is authored tools. A shell with
credentials and network is exfiltration-shaped; with neither it is a text processor.

## The bridge

```
browser → /eve/v1/*  (same origin, session cookie, x-crm-contact header)
        → apps/app/app/eve/v1/[...path]/route.ts
            checks the Better Auth session, strips the cookie,
            mints a 2-minute HS256 token naming the rep + record
        → AGENT_URL/eve/v1/* → channels/eve.ts repFromCrm()
                             → instructions/task.ts reads attributes.contactId
```

- **The record travels in the token, never in the message.**
- **Mounted at `/eve/v1/*`** because that is where `useEveAgent()` looks — no `host`,
  no CORS, no cross-site cookie.
- **The proxy is an enforcement point, not a passthrough** — the agent never sees the
  session cookie, so if that route did not check, nothing would.
- **eve's `jwtHmac()` resolves to `principalType: "service"`** — wrong for a person,
  and `lib/approval.ts` reads exactly those fields to decide whether to pause for a
  human. `repFromCrm` maps the subject to a real user principal
  (`test/channel-auth.spec.ts`).
- **`AGENT_BRIDGE_SECRET` unset skips the auth entry rather than opening it.**

### The panel

`lib/agent-record.ts` maps a record kind to everything downstream. The panel's own
rules — snapshot loading, composer state, thread capture, scrolling — are in
**`docs/agent-panel.md`**. It lives in the API and is not a breach of rule one:
listing history decides nothing.

## Continuation tokens are namespaced

**eve prefixes them with the channel name.** `channels/crm.ts` mints `task:<id>`;
`session.waiting` returns `crm:task:<id>`. Minting the prefix ourselves meant matching
against `crm:crm:task:<id>` and returning before `completeTask` — research ran, facts
were written, sessions looked clean, but **no task reached `finishedAt`**, so contacts
sat on "Researching" forever. Hidden because the archived event's
`data.continuationToken` is *un-namespaced* while `channel.continuationToken` is not.

**`taskFromToken` keys on the `task:` marker, not a fixed prefix**
(`test/crm-token.spec.ts`). **A channel handler must not assume the token it receives
is byte-identical to the one it sent.**
