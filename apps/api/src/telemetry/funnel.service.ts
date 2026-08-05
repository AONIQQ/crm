import type { Db } from "@crm/db";
import { FactStatus } from "@crm/db";
import {
	MILESTONES,
	type Milestone,
	milestone,
	reachedMilestones,
	readInstall,
} from "@crm/telemetry";
import { Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { SEED_OWNER_PREFIX } from "./seed";

@Injectable()
export class FunnelService {
	private readonly logger = new Logger(FunnelService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	async sweep(): Promise<Milestone[]> {
		const reached = new Set(await reachedMilestones());
		const outstanding = MILESTONES.filter((step) => !reached.has(step));
		if (outstanding.length === 0) return [];

		const sent: Milestone[] = [];

		for (const step of outstanding) {
			try {
				const at = await this.when(step);
				if (!at) continue;
				if (await milestone(step, at)) sent.push(step);
			} catch (error) {
				this.logger.debug({
					message: "Could not settle a telemetry milestone",
					step,
					reason: error instanceof Error ? error.message : String(error),
				});
			}
		}

		return sent;
	}

	private async when(step: Milestone): Promise<Date | null> {
		switch (step) {
			case "migrations_applied":
				return (await readInstall())?.createdAt ?? null;

			case "first_sign_in":
				return this.earliest(
					this.db.session.findFirst({
						orderBy: { createdAt: "asc" },
						select: { createdAt: true },
					}),
					(row) => row.createdAt,
				);

			case "google_oauth_configured":
				return process.env.GOOGLE_CLIENT_ID?.trim() &&
					process.env.GOOGLE_CLIENT_SECRET?.trim()
					? new Date()
					: null;

			case "first_mailbox_sync":
				return this.earliest(
					this.db.mailboxSync.findFirst({
						where: { lastSyncedAt: { not: null } },
						orderBy: { lastSyncedAt: "asc" },
						select: { lastSyncedAt: true },
					}),
					(row) => row.lastSyncedAt,
				);

			case "first_non_seed_contact":
				return this.earliest(
					this.db.contact.findFirst({
						where: {
							OR: [
								{ ownerId: null },
								{ ownerId: { not: { startsWith: SEED_OWNER_PREFIX } } },
							],
						},
						orderBy: { createdAt: "asc" },
						select: { createdAt: true },
					}),
					(row) => row.createdAt,
				);

			case "first_agent_task_claimed":
				return this.earliest(
					this.db.agentTask.findFirst({
						where: { startedAt: { not: null } },
						orderBy: { startedAt: "asc" },
						select: { startedAt: true },
					}),
					(row) => row.startedAt,
				);

			case "first_agent_task_completed":
				return this.earliest(
					this.db.agentTask.findFirst({
						where: { finishedAt: { not: null } },
						orderBy: { finishedAt: "asc" },
						select: { finishedAt: true },
					}),
					(row) => row.finishedAt,
				);

			case "first_fact_applied":
				return this.earliest(
					this.db.contactFact.findFirst({
						where: { status: FactStatus.APPLIED },
						orderBy: { observedAt: "asc" },
						select: { observedAt: true, decidedAt: true },
					}),
					(row) => row.decidedAt ?? row.observedAt,
				);
		}
	}

	private async earliest<T>(
		query: PromiseLike<T | null>,
		pick: (row: T) => Date | null,
	): Promise<Date | null> {
		const row = await query;
		return row ? pick(row) : null;
	}
}
