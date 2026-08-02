import type { Db } from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

@Injectable()
export class AgentTriggerService {
	private readonly logger = new Logger(AgentTriggerService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	async companyCreated(
		companyId: string,
		reason = "New company",
	): Promise<void> {
		await this.enqueue({
			companyId,
			kind: "company-profile",
			reason,
			priority: 10,
			budget: 4,
		});
	}

	async companyRequested(companyId: string, reason: string): Promise<void> {
		await this.enqueue({
			companyId,
			kind: "company-profile",
			reason,
			priority: 100,
			budget: 8,
		});
	}

	async contactCreated(contactId: string, reason: string): Promise<void> {
		await this.enqueue({
			contactId,
			kind: "identify",
			reason,
			priority: 20,
			budget: 4,
		});
	}

	async meetingSoon(contactId: string, when: Date): Promise<void> {
		await this.enqueue({
			contactId,
			kind: "meeting-prep",
			reason: `Meeting on ${when.toDateString()} with someone we know nothing about`,
			priority: 200,
			budget: 10,
		});
	}

	async backfill(input: {
		kind: string;
		reason: string;
		contactIds?: string[];
		companyIds?: string[];
		budget?: number;
	}): Promise<{ queued: number; alreadyQueued: number }> {
		const subject = input.contactIds ? "contactId" : "companyId";
		const ids = [...new Set(input.contactIds ?? input.companyIds ?? [])];
		if (ids.length === 0) return { queued: 0, alreadyQueued: 0 };

		try {
			const outstanding = await this.db.agentTask.findMany({
				where: {
					kind: input.kind,
					finishedAt: null,
					[subject]: { in: ids },
				},
				select: { [subject]: true },
			});

			const taken = new Set(
				outstanding.map((row) => (row as Record<string, unknown>)[subject]),
			);
			const fresh = ids.filter((id) => !taken.has(id));

			if (fresh.length > 0) {
				await this.db.agentTask.createMany({
					data: fresh.map((id) => ({
						contactId: input.contactIds ? id : null,
						companyId: input.companyIds ? id : null,
						kind: input.kind,
						reason: input.reason,
						priority: 50,
						budget: input.budget ?? 4,
						dueAt: new Date(),
					})),
				});
			}

			this.logger.log({
				message: "Backfill queued",
				kind: input.kind,
				queued: fresh.length,
				alreadyQueued: ids.length - fresh.length,
			});

			return {
				queued: fresh.length,
				alreadyQueued: ids.length - fresh.length,
			};
		} catch (error) {
			this.logger.error(
				{ message: "Could not queue backfill", kind: input.kind },
				error instanceof Error ? error.stack : String(error),
			);
			throw error;
		}
	}

	private async enqueue(task: {
		contactId?: string;
		companyId?: string;
		kind: string;
		reason: string;
		priority: number;
		budget: number;
	}): Promise<void> {
		try {
			const pending = await this.db.agentTask.findFirst({
				where: {
					kind: task.kind,
					finishedAt: null,
					...(task.contactId ? { contactId: task.contactId } : {}),
					...(task.companyId ? { companyId: task.companyId } : {}),
				},
				select: { id: true },
			});

			if (pending) return;

			await this.db.agentTask.create({
				data: {
					contactId: task.contactId ?? null,
					companyId: task.companyId ?? null,
					kind: task.kind,
					reason: task.reason,
					priority: task.priority,
					budget: task.budget,
					dueAt: new Date(),
				},
			});

			this.logger.log({
				message: "Agent task queued",
				kind: task.kind,
				contactId: task.contactId,
				companyId: task.companyId,
			});
		} catch (error) {
			this.logger.error(
				{ message: "Could not queue agent task", kind: task.kind },
				error instanceof Error ? error.stack : String(error),
			);
		}
	}
}
