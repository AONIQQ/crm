# CRM

Turborepo monorepo, managed with [Bun](https://bun.com).

## What's inside

### Apps

- `app` — [Next.js](https://nextjs.org/) front end, port 3000
- `api` — [NestJS](https://nestjs.com/) API, runs on Bun, port 3001

### Packages

- `@crm/auth` — [Better Auth](https://better-auth.com) configuration (server + client)
- `@crm/db` — Prisma schema, migrations, and the shared PostgreSQL client
- `@crm/ui` — [shadcn/ui](https://ui.shadcn.com) `radix-nova` design system, Tailwind theme, and `cn()`
- `@crm/typescript-config` — shared `tsconfig.json` bases

These packages are just-in-time: they export TypeScript sources and are compiled
by whatever consumes them.

### UI

`@crm/ui` owns the component library and the single Tailwind entry point. Apps
import the stylesheet once and pull components from subpath exports:

```tsx
import "@crm/ui/globals.css"; // app/layout.tsx
import { Button } from "@crm/ui/components/button";
import { cn } from "@crm/ui/lib/utils";
```

The component set, the theme and the `cds-icon` animations are shared with the
Comp AI MVP app so the two products look like one. That means:

- **shadcn style `radix-nova`**, built on [Radix](https://www.radix-ui.com)
  (plus `sonner`, `vaul`, `cmdk`, `recharts`). Components use Radix's `asChild`
  API — not Base UI's `render` prop.
- **[Carbon](https://carbondesignsystem.com/libraries/icons/) icons** for
  product chrome, imported one glyph at a time and rendered through the `Icon`
  wrapper, which attaches the hover motion defined in `globals.css`:

  ```tsx
  import Dashboard from "@carbon/icons-react/es/Dashboard";
  import { Icon } from "@crm/ui/components/icon";

  <Icon icon={Dashboard} />;
  ```

  Lucide is still a dependency because the vendored shadcn components use it
  internally; prefer Carbon for anything you write.

Add components with the shadcn CLI from `apps/app` — the monorepo aliases in
`components.json` route the files into `packages/ui`:

```sh
cd apps/app
bunx --bun shadcn@latest add <component>
```

Design tokens live in `packages/ui/src/styles/globals.css`; that file also
declares the Tailwind `@source` globs. Consuming apps re-export the shared
PostCSS config and list `@crm/ui` in `transpilePackages`.

Files under `packages/ui/src/components` are vendored from upstream and excluded
from Biome so `shadcn add --diff <component>` stays readable when re-syncing.

### Auth

Sign-in is **Google only** — this is an internal tool, so there are no
organizations, no passwords and no invitations.

The **API** owns authentication. It mounts `/api/auth/*` through
`@thallesp/nestjs-better-auth` and is the only process that writes session
cookies. The **app** reads those sessions straight out of Postgres via
`@crm/auth` (no HTTP round trip) and sends the browser to the API for sign-in
and sign-out.

```
browser ──sign in──▶  api:3001/api/auth/*  ──▶ Google
   │                        │
   │                   session cookie
   ▼                        ▼
app:3000 ──cookie──▶  Postgres (@crm/db)
   └──── fetch /auth/me, /health ────▶ api:3001
```

Both processes therefore need the **same** `BETTER_AUTH_SECRET` and
`DATABASE_URL`. On localhost the shared cookie works because cookies ignore
ports; on separate subdomains set `AUTH_COOKIE_DOMAIN` to the shared parent.

`apps/app/proxy.ts` does an optimistic cookie check to keep anonymous traffic
off protected routes; `requireSession()` in `apps/app/lib/session.ts` is the
authoritative check every protected page runs.

Because Google is the only door, there is no way to get a session from a
terminal. `bun run --filter=api dev:session [email]` writes the rows Better Auth
would have written and prints the cookie it would have set — development only,
and it refuses to run with `NODE_ENV=production`.

### Data

The app talks to the API over **tRPC** (`nestjs-trpc`), mounted at `/api/trpc`.

```
apps/app  ──/api/trpc──▶ app/api/[...path]/route.ts ──▶ api:3001/api/trpc
   server components: getServerTrpc() + prefetch → <HydrateClient>
   client components: useTRPC() + TanStack Query
```

The catch-all route handler is a same-origin passthrough. Without it every call
from the browser would be a cross-origin credentialed request, with the CORS and
cookie rules that implies; with it, `/api/trpc` is local and the session cookie
just works.

`apps/api` exports the generated router type as `api/app-router`, so the app is
type-safe from the Prisma row to the table cell. It is generated, not written:
`bun run dev` keeps `nestjs-trpc watch` running alongside the API, and
`bun run --filter=api trpc:generate` refreshes it once. If a new procedure is
invisible to the app, that is what has not run.

List URLs are state: filters, sort and page live in the query string via
[nuqs](https://nuqs.dev), parsed once per module in a `*-search-params.ts` so
the server prefetch and the client table cannot disagree. Copying the URL
reproduces the view.

### The agent

Company knowledge — logo, description, industry, address, socials — is filled
in by [Context.dev](https://context.dev) rather than typed by a human.
`apps/api/src/enrichment` holds a thin typed client, a small in-process queue
(concurrency 2, one retry, per-domain dedupe) and the field mapping.

It runs on company create, on a domain change, and on the "Re-enrich" button;
"Research" reads the company's site and posts a brief to its timeline. Two
rules the mapping never breaks: it only ever **fills gaps**, so a value a rep
typed is never overwritten by a guess, and logos are chosen by `mode`+`type`
rather than by taking `logos[0]`.

Set `CONTEXT_DEV_API_KEY` in `apps/api/.env` to switch it on. Without it the
agent is disabled, the API logs one warning at boot, and companies simply stay
`PENDING` — nothing else changes.

### Importing from HubSpot

`/import` takes a HubSpot CSV export of companies, contacts or deals. It always
dry-runs first and shows a per-row report — outcome, the record it matched, and
why anything was skipped — before anything is written.

Matching is on `domain` for companies and `email` for contacts, both unique, so
re-running an import updates rather than duplicates. A company row with no
domain falls back to an exact name match, and the report says so. Deals match on
name within a company, and need the companies imported first.

### Tooling

- [TypeScript](https://www.typescriptlang.org/) for static type checking
- [Biome](https://biomejs.dev/) for linting and formatting

## Getting started

```sh
bun install

cp packages/db/.env.example packages/db/.env
cp apps/api/.env.example apps/api/.env
cp apps/app/.env.example apps/app/.env

openssl rand -base64 32   # -> BETTER_AUTH_SECRET, the SAME value in both .env files

bun run db:generate
bun run db:deploy         # applies the migrations
bun run dev
```

Then create a Google OAuth client (Google Cloud console → Credentials → OAuth
client ID → Web application), add `http://localhost:3001/api/auth/callback/google`
as an authorised redirect URI, and put the pair in `apps/api/.env` as
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. The API refuses to boot without
them — Google is the only way in.

No local Postgres? `bunx prisma dev` (from `packages/db`) starts one and prints
a `DATABASE_URL`.

## Tasks

| Command                | What it does                                     |
| ---------------------- | ------------------------------------------------ |
| `bun run dev`          | Every app in watch mode                          |
| `bun run build`        | Build all apps and packages                      |
| `bun run lint`         | `biome check` in every package                   |
| `bun run check-types`  | `tsc --noEmit` in every package                  |
| `bun run format`       | Format the whole repo with Biome                 |
| `bun run db:migrate`   | Create and apply a Prisma migration              |
| `bun run db:studio`    | Open Prisma Studio                               |
| `bun run auth:generate`| Regenerate the auth models in the Prisma schema  |
| `bun run --filter=api trpc:generate` | Regenerate the `AppRouter` type the app imports |
| `bun run --filter=api dev:session` | Print a signed session cookie for a local user |

Scoped runs use Turborepo filters:

```sh
bun exec turbo run dev --filter=api
```

## Environment

`.env` files live in the package that reads them — `packages/db/.env` for
`DATABASE_URL`, `apps/api/.env` for the API, `apps/app/.env` for the front end.
There is no root `.env`.

`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` and `DATABASE_URL` are duplicated across
`apps/api/.env` and `apps/app/.env` on purpose: both processes run Better Auth
against the same database, and they must agree or the cookie one writes will not
verify in the other.
# crm
