# Agent — Rules for working on `apps/agent`

The research agent works out who the people in the CRM are. It is an
[eve](https://eve.dev/docs) app, it is **its own deployment**, and it owns every
piece of intelligence in this repo.

Read this with [`api.md`](./api.md) — whose first rule is that none of this may
move into the API — and
[`plan/contact-intelligence-agent.md`](./plan/contact-intelligence-agent.md),
which is why it is shaped this way.

## The framework is the source of truth

The complete eve documentation ships inside the package, matching the installed
version exactly:

```
apps/agent/node_modules/eve/docs/README.md
```

Read the relevant guide there before writing eve code. Guessing at this API is
expensive in a specific way: it typechecks, builds, and then behaves differently
from what you assumed — see the note on principal mapping under [the
bridge](#the-bridge).

## Evidence, not confidence

**No tool accepts a confidence, a score, or a `sourceUrl` offered as proof.** A
tool reports what it *observed* — `crm.signature-block`, `github.account-identity`
— and `lib/evidence.ts` prices it. This is the rule the whole design rests on:
a model asked to grade its own certainty will, and it will be wrong in the
direction that makes it look useful.

- `lib/evidence.ts` — the weights, the combination rule, the bands.
- `lib/facts.ts` — the only write path to a contact's fields. Applies at
  `VERIFIED`, stores a proposal below it, and enforces three things a prompt
  cannot: never overwrite a human, never re-offer a dismissal, never write
  without a primary source.
- The bands are behaviour, not labels. `PROBABLE` means *a rep decides*, and
  that is a correct outcome — four Bighams work at HubSpot.

Adding a fact field means adding it to `FIELDS` in `lib/facts.ts` **and** to
`FACT_COLUMNS` in `apps/api/src/contacts/contacts.service.ts`, which is where an
accepted proposal writes through.

## Optional by default

Every outside source is optional and the agent is designed to run with none.
`lib/capabilities.ts` is the single place that knows what is set: it prints the
list at boot, states it in the session instructions so the agent plans around
what it has, and gives tools a shared "not configured, and retrying will not
help" result — checked **before** the research budget is charged.

A missing key removes a place to look. It is never an error, and it must never
throw.

## Budget, and deciding what to do next

- `lib/focus.ts` holds the per-session budget in `defineState`. Every vendor
  call charges it. Running out is a normal ending.
- `lib/tasks.ts` is the work queue. `claimDue` leases rows with
  `FOR UPDATE SKIP LOCKED`, so two dispatchers take disjoint work and a run that
  dies frees its row when the lease expires.
- `schedules/dispatch.ts` is the **only** schedule. It decides nothing: it
  leases what is due and starts a session per row. Anything that looks like
  "every N minutes, the oldest ten contacts" belongs in a task's `dueAt`, not in
  a cron expression.
- `tools/schedule_recheck.ts` is how the agent books its own next look, and its
  `reason` is shown to the rep. An agent that cannot say why it will be back in
  fourteen days does not have a reason, it has a default.

## What the agent may read, and what may leave

It may read **everything**, including full email bodies — single-tenant internal
tool, and a signature block is the best source of a job title there is. The
boundary is egress, and it is three rules:

1. No customer text in a third-party query. Derived questions only.
2. Nothing from a mailbox into `/workspace`. The sandbox has a different
   lifetime.
3. Nothing sensitive logged. Reading is not logging.

`skills/data-boundaries.md` is the agent's copy of this. Keep them in step.

## The sandbox

`agent/sandbox/sandbox.ts` turns on `bash`, the file tools, and a `/workspace`,
with **`deny-all` egress** set on the backend factory so it cannot be forgotten
per session. That costs nothing: `web_fetch` runs in the app runtime and
`web_search` at the model provider, so retrieval is unaffected.

**Never give the sandbox `DATABASE_URL`.** CRM access is authored tools in the
app runtime. A shell with credentials and network is exfiltration-shaped even in
an internal tool; a shell with neither is a text processor.

## The bridge

The contact sheet's **Agent** tab talks to a running agent. The path:

```
browser  →  /eve/v1/*  (same origin, session cookie)
         →  apps/app/app/eve/v1/[...path]/route.ts
              checks the Better Auth session
              strips the cookie
              mints a 2-minute HS256 token naming the rep
         →  AGENT_URL/eve/v1/*
              agent/channels/eve.ts → repFromCrm() verifies it
```

Mounted at `/eve/v1/*` deliberately: that is where `useEveAgent()` looks by
default, so the hook needs no `host` and there is no CORS and no cross-site
cookie anywhere in it. It is the same trade the app already makes for the API.

Three things worth knowing before you touch it:

- **The proxy is an enforcement point, not a passthrough.** The agent never sees
  the session cookie, so if that route did not check the session, nothing
  downstream would.
- **eve's `jwtHmac()` helper resolves an HMAC token to
  `principalType: "service"`** with a namespaced `principalId`. Correct for a
  machine credential, wrong for a person — and `lib/approval.ts` decides whether
  to pause for a human by reading exactly those fields, so a rep would have been
  refused a sensitive write while sitting there watching. `repFromCrm` wraps
  `verifyJwtHmac` and maps the subject to a real user principal.
  `test/channel-auth.spec.ts` pins it.
- **`AGENT_BRIDGE_SECRET` unset skips the auth entry rather than opening it.**
  The panel stops working; the agent keeps running its own schedule. An
  optional capability's absence must never widen access.

### Turning it on

Same value in both processes, from the one root `.env`:

```sh
AGENT_URL="http://localhost:2000"        # the default
AGENT_BRIDGE_SECRET="$(openssl rand -base64 32)"
```

Then `bun run dev` (the agent serves on `:2000`) and open any contact.

**If the Agent tab errors:**

| Symptom | Cause |
| --- | --- |
| `503`, "not configured for this install" | `AGENT_BRIDGE_SECRET` is unset in the app's process |
| `401` | The two processes hold *different* secrets |
| `502`, "not reachable" | The agent is not running, or `AGENT_URL` is wrong |

A variable in `.env` is not enough on its own: Turbo runs in strict env mode, so
`apps/app/turbo.json` and `apps/agent/turbo.json` both declare the pair in
`passThroughEnv`. Adding a variable and not declaring it produces exactly the
`401` above.

### Checking it without a browser

`localDev()` accepts anything on loopback, so a bare `curl` to `127.0.0.1`
proves nothing about the bridge. Send a non-loopback `Host` to make that entry
skip:

```sh
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'Host: agent.example.com' \
  http://127.0.0.1:2000/eve/v1/info                      # 401

curl -s -H 'Host: agent.example.com' \
  -H "authorization: Bearer $TOKEN" \
  http://127.0.0.1:2000/eve/v1/info | jq '.tools.available | length'
```

`GET /eve/v1/info` is the whole inventory — tools, skills, schedules, channels,
sandbox, and a `diagnostics` count that is the fastest way to find a file eve
silently ignored.

## Tests

`bun run --filter=agent test`. The integration specs need `DATABASE_URL` and run
against a real Postgres, which is the point — "never overwrite a human" is only
true if the transaction says so.
