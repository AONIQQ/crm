# `@crm/db`

PostgreSQL access for the monorepo: the Prisma schema, migrations, and a shared
`PrismaClient` instance.

## Usage

```ts
import { db } from "@crm/db";

const users = await db.user.findMany({ take: 10 });
```

Types and query helpers come from the same entrypoint:

```ts
import { Prisma, type User } from "@crm/db";
```

## Setup

```bash
cp packages/db/.env.example packages/db/.env   # then edit DATABASE_URL
bun run db:generate                            # generate Prisma Client
bun run db:deploy                              # apply the initial migration
```

`prisma/migrations/20260731150000_init` was generated offline with
`prisma migrate diff` and has not been applied to any database yet. Delete it
and run `bun run db:migrate` instead if you would rather let Prisma author the
first migration against your own database.

`DATABASE_URL` lives in `packages/db/.env` rather than at the repo root so that
the dependency is explicit and cache invalidation stays scoped to this package.

## Scripts

| Script        | Purpose                                                  |
| ------------- | -------------------------------------------------------- |
| `build`       | `prisma generate` — cached by Turborepo, runs via `^build` |
| `db:generate` | Regenerate Prisma Client                                 |
| `db:migrate`  | Create and apply a migration (development)               |
| `db:deploy`   | Apply pending migrations (CI / production)               |
| `db:push`     | Push the schema without a migration (prototyping only)   |
| `db:reset`    | Drop and recreate the database                           |
| `db:seed`     | Run `prisma/seed.ts`                                     |
| `db:studio`   | Open Prisma Studio                                       |

Each is also exposed at the repo root (`bun run db:migrate`) and routed through
`turbo run`.

## Notes

- **Prisma 7 + driver adapter.** There is no query engine binary; the client
  talks to PostgreSQL through `@prisma/adapter-pg`. See `src/client.ts`.
- **Generated code is not committed.** `prisma generate` writes to
  `src/generated/`, which is gitignored and declared as the `build` task's
  output so Turborepo caches it.
- **JIT package.** `exports` point at TypeScript sources; the consumer compiles
  them. Turbopack transpiles workspace packages automatically, so a Next.js app
  needs no `transpilePackages` entry. Non-bundler consumers need a TypeScript
  runtime — the NestJS API runs on Bun for exactly this reason.
- **Auth models are generated.** `User`, `Session`, `Account`, `Verification`
  and `RateLimit` come from `@better-auth/cli`. Do not hand-edit them — change
  the Better Auth config in `@crm/auth` and re-run `bun run auth:generate`.
  The generator is additive: it adds models and fields a plugin needs but never
  removes the ones a dropped plugin left behind, so removing a plugin means
  deleting its models from the schema by hand.
