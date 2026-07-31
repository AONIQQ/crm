# `@crm/auth`

[Better Auth](https://better-auth.com) configuration for the monorepo, backed by
`@crm/db`.

Enabled: Google sign-in, account linking, cookie-cached sessions, and
database-backed rate limiting. This is an internal, single-tenant app — there
are no organizations, and email + password is switched off so the only way in
is a Google account.

## Topology

The **NestJS API** (`apps/api`, port 3001) mounts `/api/auth/*` via
`@thallesp/nestjs-better-auth` and is the only process that writes session
cookies. The **Next.js app** (`apps/app`, port 3000) imports this package on the
server to *read* sessions straight from Postgres, and points its browser client
at the API for sign-in and sign-out.

Both processes therefore need the same `BETTER_AUTH_SECRET` and `DATABASE_URL`,
or the cookie one writes will not verify in the other.

## Usage

### Server

```ts
import { auth } from "@crm/auth";

// Session for an incoming request
const session = await auth.api.getSession({ headers: request.headers });
```

`auth.handler` is a standard `(Request) => Promise<Response>` function, so it
mounts anywhere. In a Next.js App Router route (`app/api/auth/[...all]/route.ts`):

```ts
import { auth } from "@crm/auth";

export const GET = auth.handler;
export const POST = auth.handler;
```

### Client

```ts
import { signIn, signOut, useSession } from "@crm/auth/client";

await signIn.social({ provider: "google", callbackURL: "/" });
```

`NEXT_PUBLIC_AUTH_URL` decides which origin the client talks to. It must point
at whichever process mounts the handler; unset, the client uses the current
origin.

The client plugin list mirrors the server plugin list. Keep them in sync or the
inferred client API will drift from the routes the server exposes.

## Setup

```bash
cp packages/auth/.env.example packages/auth/.env
openssl rand -base64 32   # -> BETTER_AUTH_SECRET
```

Create an OAuth client in the Google Cloud console and add
`<BETTER_AUTH_URL>/api/auth/callback/google` — `http://localhost:3001/api/auth/callback/google`
in development — as an authorised redirect URI.

`BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are read from the environment by
Better Auth itself and are deliberately not passed through config.

## Changing the schema

Adding a plugin or an additional user field changes the database schema. After
editing `src/auth.ts`:

```bash
bun run auth:generate   # rewrites packages/db/prisma/schema.prisma
bun run db:migrate      # create the migration
```

## Notes

- **JIT package.** `exports` point at TypeScript sources, which keeps Better
  Auth's inferred types intact — declaration emit tends to break them.
  Turbopack transpiles workspace packages automatically, so a Next.js app needs
  no `transpilePackages` entry.
- **Next.js server actions** need the `nextCookies()` plugin (from
  `better-auth/next-js`) as the *last* entry in the plugin array. It is omitted
  here so the package stays framework-agnostic; add it — along with `next` as a
  dependency — once an app relies on setting cookies from server actions.
- **Cross-origin cookies.** On localhost the API and the app differ only by
  port, which cookies ignore. Deployed on separate subdomains they need
  `AUTH_COOKIE_DOMAIN` set to the shared parent (`.example.com`).
