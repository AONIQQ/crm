
# API Rules - Always review when working on our API

## Logging: use the Nest logger, attach fields, never `console.log`

Logging lives in `apps/api/src/logging`. `ContextLogger` extends Nest's
`ConsoleLogger` and is installed in `main.ts`, so `new Logger(Thing.name)`
anywhere in the app picks it up. **Format and level are not configurable** —
they follow `NODE_ENV`: JSON at `log` and above in production, colourised with
`debug`/`verbose` locally.

- **Attach data as one object, not extra arguments.** Nest prints one line per
  argument, so `logger.log("Saved", { userId })` emits two lines. Write
  `logger.log({ message: "Saved", userId })` instead — the fields are hoisted to
  the top level in JSON and rendered after the text in development.
- **Errors pass the stack as the second argument**:
  `logger.error({ message: "…" }, error instanceof Error ? error.stack : String(error))`.
  Handing Nest the error object instead prints it as a second message and drops
  the trace.
- **Every request carries a `requestId`**, generated (or taken from an inbound
  `x-request-id`) by `RequestLoggerMiddleware`, returned on the response header,
  included in error bodies, and stored in `AsyncLocalStorage` so every log line
  during that request is correlated. `UserContextInterceptor` adds `userId` once
  the auth guard has resolved the session.
- **Better Auth routes are logged through its `middleware` option**
  (`BetterAuthModule.forRoot({ auth, middleware: logAuthRoute })`). It mounts its
  handler straight onto the HTTP adapter during module configuration, before
  Nest applies anything from `MiddlewareConsumer`, so `/api/auth/*` would
  otherwise never reach the middleware. `LoggingModule` must stay **first** in
  `AppModule`'s imports for the same reason.
- **Never log headers, query strings, or request bodies.** They routinely carry
  session cookies and personal data. Log the specific fields a handler knows are
  safe.
- **Prisma statement logging is opt-in** via `PRISMA_LOG_QUERIES=true`, and is
  emitted at `debug`. It is off by default because it buries every other line
  under a wall of `SELECT`s. Bound parameters are dropped even when it is on.
  Prisma warnings and errors always flow through the app logger via
  `PrismaLogBridge`; outside the API (seeds, scripts, the Next.js app) they fall
  back to the console sink in `packages/db/src/client.ts`.

## There are no organizations

This is an internal tool behind Google sign-in, and it is **single tenant**.
There is no `Organization` model, no `x-organization-slug` header, no org
context interceptor, and no org-scoped cache keys. "Signed in" is the entire
authorisation model.

If you are porting something from the Comp AI MVP, delete the org plumbing
rather than stubbing it — an `organizationId` that is always the same value is
a column, an index and a `where` clause that buy nothing, and a permissions
check that always returns `true` reads like a real one at review time.

## tRPC is the data surface; REST is for auth and health

Everything the app reads or writes goes through `nestjs-trpc` routers under
`/api/trpc`, wired in `apps/api/src/trpc`. The remaining REST controllers are
`/api/auth/*` (Better Auth) and `/health`.

- **One router per module**, named `*.router.ts` so the codegen glob finds it,
  carrying `@Router({ alias: "…" })` and `@UseMiddlewares(AuthMiddleware)`.
  A router with no `AuthMiddleware` is public — there is no other guard.
- **Routers are thin.** They validate input with zod and call a service; the
  Prisma work lives in `*.service.ts`, which is also where a REST controller or
  a background job would call in.
- **Services throw Nest's `HttpException` family** (`NotFoundException`,
  `BadRequestException`, …). `DomainErrorMiddleware` maps those onto tRPC error
  codes, so a service does not need to know it is being called over tRPC.
- **Filtering, sorting and pagination happen in Prisma.** List procedures take
  the shared `listInput` (`apps/api/src/trpc/list-input.ts`) and return
  `{ rows, total, facetCounts }`. Never return a whole table and filter in the
  browser, and never interpolate `sort` into a Prisma field name — resolve it
  through `resolveOrderBy` against the columns that module allows.
- **The router type is generated**, not hand-written:
  `bun run --filter=api trpc:generate` writes `src/generated/server.ts`, which
  the app imports as `type { AppRouter } from "api/app-router"`. `bun run dev`
  keeps it in watch mode. If the app cannot see a new procedure, the generator
  has not run.
- **`src/generated/server.ts` is committed, and `build` must never regenerate
  it.** The generator ships a native binary that needs GLIBC 2.39 — newer than
  Vercel's build image — so a `build` task that depends on `trpc:generate` fails
  every deploy. That is why `apps/api/.gitignore` ignores `src/generated/*` with
  a `!src/generated/server.ts` exception, and why only `check-types` and `dev`
  run the generator. Regenerate locally and commit the result with the router
  change that caused it.

## Freshness: invalidate the query, don't disable the cache

There is no HTTP response cache in front of tRPC. Freshness is TanStack Query's
job: a mutation invalidates the query keys it affected, and the list refetches.

- **Invalidate on the client, in the mutation's `onSuccess`** — but **through
  `useCrmCache()`** (`apps/app/lib/trpc/cache.ts`), not by listing keys at the
  call site. Say *what changed* (`cache.deal(id)`, `cache.company(id)`,
  `cache.contact(id)`, `cache.activity()`) and the module owns the fan-out. Twelve
  hand-written key lists is how they drifted: a stage change did not refresh the
  timeline entry it writes, creating a deal did not refresh the board, and nothing
  refreshed the overview, so a rep could close a deal and watch their own numbers
  not move. **A new mutation adds a call there, not a new list of keys.**
- **Pass `{ settle: "record" }`** when the caller is an inline editor. The
  default waits for every affected view to refetch, which is right when the point
  of the action *is* the view changing (a card moving between board columns);
  `"record"` waits only for the edited record so the field's spinner clears as
  soon as the value under it is right, and lets the table behind the sheet catch
  up on its own.
- **An infinite query needs `pathKey()`, not `queryKey()`.** tRPC stamps the
  query type into the key, so `queryKey()` yields `{ type: "query" }` and
  `infiniteQueryOptions` caches under `{ type: "infinite" }` — the two cannot
  partially match, and invalidating with the wrong one is silent: it reports
  success, refetches the sibling non-infinite queries, and leaves the infinite
  one stale until a reload. `pathKey()` carries no type and matches both, which
  is what you want whenever a procedure is read both ways (`activities.timeline`
  is, as a paged history and as a pinned top-ten).
- **`cache-manager` is still there** (`apps/api/src/cache`, Redis when
  `REDIS_URL` is set) but it is used deliberately, per value, by services that
  want it — `AuthService.getProfile` is the model: read through, write on miss,
  and an explicit `invalidateProfile` on change. It is not a global interceptor,
  so nothing is cached unless a service asks for it.
- **Background writes the browser cannot see** — enrichment finishing, most
  obviously — are not invalidations at all, because no client action caused
  them. Poll for those: `refetchInterval` while the record's status is
  `PENDING`/`RUNNING`, and stop once it settles. Use `isEnriching()` and
  `ENRICHMENT_POLL_MS` from `components/crm/enrichment-status` so the rule is one
  definition. **A list polls too, not just the record sheet** — the company sheet
  polled and the companies table did not, so a newly added company's logo and
  industry appeared in the sheet and stayed blank in the table behind it until a
  reload.
