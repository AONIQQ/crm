import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseEnv } from "@crm/env";

/**
 * Refuses to run a destructive Prisma command against a database that is not
 * on this machine.
 *
 * The command that forced this: `prisma migrate dev` in `packages/db`, which
 * silently applied eleven migrations to the production Neon database. Nothing
 * was wrong with the command. The environment was wrong, and it was wrong
 * *invisibly* — `vercel env pull` writes production credentials into
 * `.env.local`, and `.env.local` beats `.env` by design, so every local
 * command quietly points at production until somebody notices.
 *
 * `migrate dev` is the sharp one: it can decide the database has drifted and
 * offer to reset it, which on a production database is the end of the
 * database. `db push` and `migrate reset` are the same class. `db:deploy` is
 * deliberately *not* guarded — pointing that at a remote database is the whole
 * point of it.
 *
 * **This resolves the URL the way Prisma will, not the way Bun would.** The
 * first version of this guard read `process.env.DATABASE_URL` and waved the
 * Neon case straight through, because Bun auto-loads the `.env` sitting in the
 * working directory before running a script, while Prisma's CLI is a Node
 * process that only sees `@crm/env/load`. The two disagreed, the guard checked
 * the wrong one, and a guard that is wrong in that direction is worse than no
 * guard at all.
 */

const LOCAL_HOSTS = new Set([
	"localhost",
	"127.0.0.1",
	"::1",
	"[::1]",
	"0.0.0.0",
]);

const command = process.argv[2] ?? "this command";
const resolved = resolveDatabaseUrl();

if (!resolved) {
	console.error(
		`\n  ${command} needs DATABASE_URL, and nothing set it.` +
			"\n  Copy .env.example to .env at the repo root.\n",
	);
	process.exit(1);
}

const host = hostOf(resolved.url);

if (LOCAL_HOSTS.has(host)) process.exit(0);

// An explicit, per-invocation opt-in. A variable in a file would be back where
// we started; this has to be typed on the line that does the damage.
if (process.env.ALLOW_REMOTE_DB === "1") {
	console.warn(`\n  ⚠ ${command} is running against ${host} — not local.\n`);
	process.exit(0);
}

console.error(
	[
		"",
		`  Refusing to run ${command} against ${host}.`,
		"",
		`  That is not a local database, and ${command} can rewrite or drop`,
		`  schemas. The value came from ${resolved.from}.`,
		"",
		resolved.from.endsWith(".env.local")
			? [
					"  `.env.local` overrides `.env`, and `vercel env pull` writes",
					"  production credentials into it. Either remove DATABASE_URL from",
					"  that file, or pull Vercel's environment somewhere inert:",
					"",
					"    vercel env pull .env.vercel",
				].join("\n")
			: "  Check which file is winning:  grep -m1 DATABASE_URL .env .env.local",
		"",
		"  To do this deliberately anyway:",
		"",
		`    ALLOW_REMOTE_DB=1 bun run ${command}`,
		"",
	].join("\n"),
);

process.exit(1);

/**
 * The value Prisma will use, and where it came from.
 *
 * Same order as `loadRootEnv`: `.env`, then `.env.local` on top. A variable
 * already in the real environment beats both — but only if it did not come
 * from a file in the working directory, which is the case this exists to catch,
 * so the files are read first and win here.
 */
function resolveDatabaseUrl(): { url: string; from: string } | null {
	const root = workspaceRoot();

	if (root) {
		for (const file of [".env.local", ".env"]) {
			const path = join(root, file);
			try {
				const url = parseEnv(readFileSync(path, "utf8")).DATABASE_URL;
				if (url) return { url, from: file };
			} catch {
				// Not there, or unreadable. Try the next one.
			}
		}
	}

	const fromEnvironment = process.env.DATABASE_URL;
	return fromEnvironment
		? { url: fromEnvironment, from: "the environment" }
		: null;
}

/** The one directory with a `package.json` that declares workspaces. */
function workspaceRoot(): string | null {
	let directory = process.cwd();

	while (true) {
		try {
			const manifest = JSON.parse(
				readFileSync(join(directory, "package.json"), "utf8"),
			) as { workspaces?: unknown };
			if (manifest.workspaces) return directory;
		} catch {
			// No manifest here, or an unreadable one. Keep walking.
		}

		const parent = dirname(directory);
		if (parent === directory) return null;
		directory = parent;
	}
}

function hostOf(value: string): string {
	try {
		return new URL(value).hostname;
	} catch {
		return value;
	}
}
