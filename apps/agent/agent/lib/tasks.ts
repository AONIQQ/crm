import { db, type Prisma } from "@crm/db";

export type LeasedTask = {
	id: string;
	contactId: string | null;
	companyId: string | null;
	kind: string;
	reason: string;
	budget: number;
	attempts: number;
};

export type TaskSubject = {
	id: string;
	contactId: string | null;
	companyId: string | null;
	kind: string;
};

const LEASE_MS = 10 * 60_000;

export const MAX_ATTEMPTS = 3;

export async function claimDue(limit: number): Promise<LeasedTask[]> {
	const now = new Date();
	const until = new Date(now.getTime() + LEASE_MS);

	return db.$queryRaw<LeasedTask[]>`
		UPDATE "agentTask" AS t
		SET "leasedUntil" = ${until},
			"startedAt" = COALESCE(t."startedAt", ${now}),
			"attempts" = t."attempts" + 1
		FROM (
			SELECT id FROM "agentTask"
			WHERE "finishedAt" IS NULL
				AND "dueAt" <= ${now}
				AND ("leasedUntil" IS NULL OR "leasedUntil" < ${now})
				AND "attempts" < ${MAX_ATTEMPTS}
			ORDER BY "priority" DESC, "dueAt" ASC
			LIMIT ${limit}
			FOR UPDATE SKIP LOCKED
		) AS due
		WHERE t.id = due.id
		RETURNING t.id, t."contactId", t."companyId", t.kind, t.reason, t.budget, t.attempts;
	`;
}

export async function retireExhausted(): Promise<TaskSubject[]> {
	const now = new Date();

	return db.$queryRaw<TaskSubject[]>`
		UPDATE "agentTask" AS t
		SET "finishedAt" = ${now},
			"outcome" = ${`Gave up after ${MAX_ATTEMPTS} attempts: the session never reported back.`}
		WHERE t."finishedAt" IS NULL
			AND t."attempts" >= ${MAX_ATTEMPTS}
			AND (t."leasedUntil" IS NULL OR t."leasedUntil" < ${now})
		RETURNING t.id, t."contactId", t."companyId", t.kind;
	`;
}

export async function completeTask(
	taskId: string,
	outcome: string,
	sessionId?: string,
): Promise<TaskSubject | null> {
	const { count } = await db.agentTask.updateMany({
		where: { id: taskId, finishedAt: null },
		data: {
			finishedAt: new Date(),
			outcome: outcome.slice(0, 500),
			...(sessionId ? { sessionId } : {}),
		},
	});

	if (count === 0) return null;

	return db.agentTask.findUnique({
		where: { id: taskId },
		select: { id: true, contactId: true, companyId: true, kind: true },
	});
}

export async function taskSubject(taskId: string): Promise<TaskSubject | null> {
	return db.agentTask.findUnique({
		where: { id: taskId },
		select: { id: true, contactId: true, companyId: true, kind: true },
	});
}

export async function noteSession(
	taskId: string,
	sessionId: string,
): Promise<void> {
	await db.agentTask.updateMany({
		where: { id: taskId, finishedAt: null },
		data: { sessionId },
	});
}

export async function scheduleTask(input: {
	contactId?: string | null;
	companyId?: string | null;
	kind: string;
	reason: string;
	dueAt: Date;
	priority?: number;
	budget?: number;
}): Promise<{ id: string }> {
	const existing = await db.agentTask.findFirst({
		where: {
			kind: input.kind,
			finishedAt: null,
			contactId: input.contactId ?? undefined,
			companyId: input.companyId ?? undefined,
		},
		select: { id: true },
	});

	if (existing) {
		await db.agentTask.update({
			where: { id: existing.id },
			data: { dueAt: input.dueAt, reason: input.reason },
		});
		return existing;
	}

	return db.agentTask.create({
		data: {
			contactId: input.contactId ?? null,
			companyId: input.companyId ?? null,
			kind: input.kind,
			reason: input.reason,
			dueAt: input.dueAt,
			priority: input.priority ?? 0,
			budget: input.budget ?? 4,
		},
		select: { id: true },
	});
}

export async function lastDecision(contactId: string) {
	return db.agentTask.findFirst({
		where: { contactId },
		orderBy: { createdAt: "desc" },
		select: {
			kind: true,
			reason: true,
			dueAt: true,
			finishedAt: true,
			outcome: true,
		},
	});
}

export type { Prisma };
