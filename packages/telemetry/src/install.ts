import "@crm/env/load";

import { db } from "@crm/db";
import { crmVersion } from "./version";

export const INSTALL_ID = "install";

export type Install = {
	uuid: string;
	version: string;
	createdAt: Date;
	lastRollupAt: Date | null;
};

const SELECT = {
	uuid: true,
	version: true,
	createdAt: true,
	lastRollupAt: true,
} as const;

let cached: Install | null = null;

export async function readInstall(): Promise<Install | null> {
	if (cached) return cached;

	try {
		const row = await db.install.findUnique({
			where: { id: INSTALL_ID },
			select: SELECT,
		});

		if (row) cached = row;
		return row;
	} catch {
		return null;
	}
}

export function forgetInstall(): void {
	cached = null;
}

export async function syncVersion(
	version = crmVersion(),
): Promise<Install | null> {
	if (!version) return readInstall();

	try {
		const row = await db.install.update({
			where: { id: INSTALL_ID },
			data: { version },
			select: SELECT,
		});

		cached = row;
		return row;
	} catch {
		return readInstall();
	}
}

export const MILESTONES = [
	"migrations_applied",
	"first_sign_in",
	"google_oauth_configured",
	"first_mailbox_sync",
	"first_non_seed_contact",
	"first_agent_task_claimed",
	"first_agent_task_completed",
	"first_fact_applied",
] as const;

export type Milestone = (typeof MILESTONES)[number];

export async function reachMilestone(step: Milestone): Promise<boolean> {
	try {
		const { count } = await db.telemetryMilestone.createMany({
			data: [{ step }],
			skipDuplicates: true,
		});

		return count === 1;
	} catch {
		return false;
	}
}

export async function reachedMilestones(): Promise<Milestone[]> {
	try {
		const rows = await db.telemetryMilestone.findMany({
			select: { step: true },
		});

		const reached = new Set(rows.map((row) => row.step));
		return MILESTONES.filter((step) => reached.has(step));
	} catch {
		return [];
	}
}

export const COUNTERS = {
	budgetExhausted: "budget_exhausted",
} as const;

export async function bumpCounter(name: string, by = 1): Promise<void> {
	try {
		await db.telemetryCounter.upsert({
			where: { name },
			create: { name, count: by },
			update: { count: { increment: by } },
		});
	} catch {
		try {
			await db.telemetryCounter.update({
				where: { name },
				data: { count: { increment: by } },
			});
		} catch {}
	}
}

export async function drainCounters(): Promise<Record<string, number>> {
	try {
		const rows = await db.$queryRaw<{ name: string; count: number }[]>`
			DELETE FROM "telemetryCounter"
			WHERE "count" > 0
			RETURNING "name", "count";
		`;

		return Object.fromEntries(rows.map((row) => [row.name, row.count]));
	} catch {
		return {};
	}
}

export async function markRollup(at: Date): Promise<void> {
	try {
		const row = await db.install.update({
			where: { id: INSTALL_ID },
			data: { lastRollupAt: at },
			select: SELECT,
		});

		cached = row;
	} catch {}
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysSince(from: Date, now = new Date()): number {
	return Math.max(0, Math.floor((now.getTime() - from.getTime()) / DAY_MS));
}

export function sameUtcDay(a: Date | null, b: Date): boolean {
	if (!a) return false;

	return (
		a.getUTCFullYear() === b.getUTCFullYear() &&
		a.getUTCMonth() === b.getUTCMonth() &&
		a.getUTCDate() === b.getUTCDate()
	);
}
