import type { Db } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

/**
 * Whether a record has agent work outstanding.
 *
 * This exists because `enrichmentStatus` cannot answer the question and was
 * being asked it anyway. `PENDING` is the column's *default*, so every contact
 * and company carries it from the moment it is inserted — and the sheet
 * rendered that as "Queued", on 62 of 73 records against 3 rows in the queue.
 * A status that is true at birth says nothing about whether anybody intends to
 * do anything.
 *
 * Reading the queue is filing, not intelligence: it counts rows the agent
 * wrote and decides nothing about a person, so it belongs on this side of
 * `docs/api.md`'s line.
 */
@Injectable()
export class AgentQueueService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	/** Of these companies, the ones with an unfinished task. */
	async queuedCompanies(ids: readonly string[]): Promise<Set<string>> {
		return this.queued("companyId", ids);
	}

	/** Of these contacts, the ones with an unfinished task. */
	async queuedContacts(ids: readonly string[]): Promise<Set<string>> {
		return this.queued("contactId", ids);
	}

	/** One record, for a detail view that has no list to batch with. */
	async isQueued(subject: {
		companyId?: string;
		contactId?: string;
	}): Promise<boolean> {
		const row = await this.db.agentTask.findFirst({
			where: {
				finishedAt: null,
				...(subject.companyId ? { companyId: subject.companyId } : {}),
				...(subject.contactId ? { contactId: subject.contactId } : {}),
			},
			select: { id: true },
		});

		return row !== null;
	}

	/**
	 * One query for the whole page rather than one per row — a list of 50
	 * companies is 50 lookups done the obvious way, on every keystroke of the
	 * table's search box.
	 */
	private async queued(
		column: "companyId" | "contactId",
		ids: readonly string[],
	): Promise<Set<string>> {
		if (ids.length === 0) return new Set();

		const rows = await this.db.agentTask.findMany({
			where: { finishedAt: null, [column]: { in: [...ids] } },
			select: { [column]: true },
			distinct: [column],
		});

		return new Set(
			rows
				.map((row) => (row as Record<string, string | null>)[column])
				.filter((id): id is string => id !== null),
		);
	}
}
