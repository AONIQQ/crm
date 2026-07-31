import { PrismaPg } from "@prisma/adapter-pg";
import { type Prisma, PrismaClient } from "./generated/prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
	throw new Error(
		"DATABASE_URL is not set. Copy packages/db/.env.example to packages/db/.env (or set it in the consuming app's environment).",
	);
}

/** A log line emitted by the Prisma engine, normalised for whichever sink is installed. */
export interface PrismaLogRecord {
	level: Prisma.LogLevel;
	message: string;
	/** The Prisma emitter, e.g. `quaint::connector::metrics`. */
	target: string;
	/** Statement timing. Present on `query` records only. */
	durationMs?: number;
}

export type PrismaLogSink = (record: PrismaLogRecord) => void;

/**
 * Seeds, one-off scripts and the Next.js app have no application logger to hand,
 * so database problems still have to surface somewhere by default.
 */
const consoleSink: PrismaLogSink = ({ level, message, target, durationMs }) => {
	const suffix = durationMs === undefined ? "" : ` (+${durationMs}ms)`;
	const line = `[prisma:${level}] ${message}${suffix} [${target}]`;

	if (level === "error") {
		console.error(line);
	} else if (level === "warn") {
		console.warn(line);
	} else {
		console.log(line);
	}
};

let sink: PrismaLogSink = consoleSink;

/**
 * Redirect Prisma engine logs. The API points this at the Nest logger so
 * database logs are formatted and correlated like every other log line.
 * Pass `null` to restore the console sink.
 */
export function setPrismaLogSink(next: PrismaLogSink | null): void {
	sink = next ?? consoleSink;
}

/**
 * Prisma logs every statement it runs when `query` is enabled, which buries
 * anything worth reading under a wall of `SELECT`s — so it is opt-in rather
 * than on in development. Bound parameters are dropped even when it is on:
 * they routinely carry session tokens and personal data.
 */
const logQueries = process.env.PRISMA_LOG_QUERIES === "true";

const logDefinitions: Prisma.LogDefinition[] = [
	{ level: "warn", emit: "event" },
	{ level: "error", emit: "event" },
	...(logQueries
		? ([
				{ level: "query", emit: "event" },
				{ level: "info", emit: "event" },
			] satisfies Prisma.LogDefinition[])
		: []),
];

const createPrismaClient = () => {
	const client = new PrismaClient({
		adapter: new PrismaPg({ connectionString }),
		log: logDefinitions,
	});

	// Every level is subscribed; the ones missing from `logDefinitions` simply
	// never fire, so the engine does no work for logs nobody asked for.
	client.$on("error", ({ message, target }) => {
		sink({ level: "error", message, target });
	});
	client.$on("warn", ({ message, target }) => {
		sink({ level: "warn", message, target });
	});
	client.$on("info", ({ message, target }) => {
		sink({ level: "info", message, target });
	});
	client.$on("query", ({ query, duration, target }) => {
		sink({ level: "query", message: query, target, durationMs: duration });
	});

	return client;
};

const globalForPrisma = globalThis as unknown as {
	prisma: ReturnType<typeof createPrismaClient> | undefined;
};

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
	globalForPrisma.prisma = db;
}

export type Db = typeof db;
