import { db, EnrichmentStatus } from "@crm/db";
import type { TaskSubject } from "./tasks";

/**
 * The enrichment status on a record, driven by the task lifecycle.
 *
 * This exists because the previous arrangement asked the model to keep the
 * status honest and it could not. `enrich_company` writes RUNNING and COMPLETE
 * around its own vendor call, which is right as far as it goes — but a
 * `company-profile` session that answers without reaching for that tool leaves
 * the record saying PENDING with no work outstanding, and a contact had no
 * equivalent at all. `setEnrichmentStatus` was written for contacts and never
 * called from anywhere, so every contact in the database sat at PENDING from
 * the moment it was inserted, which the UI rendered as "Queued" forever.
 *
 * So the status follows the queue rather than the model's intentions: claimed
 * is RUNNING, parked is COMPLETE, given up on is FAILED. A tool that knows
 * something more specific still wins — see `UNSETTLED`.
 *
 * COMPLETE means *we looked and the run finished*, not *we found everything*.
 * That is already what `enrich_company` means by it: it settles COMPLETE even
 * when the vendor returned nothing new, with a note saying so.
 */

/**
 * Somebody is working on this now.
 *
 * Unconditional, and it has to be: a retry after a failed attempt is genuinely
 * running again, so gating this on the previous status would strand a record
 * on FAILED while a session was actively researching it.
 */
export async function markRunning(subject: TaskSubject): Promise<void> {
	await write(subject, EnrichmentStatus.RUNNING, null, false);
}

/**
 * Nobody is working on this any more, and here is how it ended.
 *
 * Only from RUNNING, which is what lets a tool win. A tool that reached a
 * terminal answer knows more than the queue does — that a company has no domain
 * to look up (SKIPPED), or that the vendor refused (FAILED, with the reason) —
 * and settling the task must not flatten those into a bland COMPLETE and lose
 * the message the rep would have read.
 */
export async function settle(
	subject: TaskSubject,
	status: EnrichmentStatus,
	error?: string,
): Promise<void> {
	await write(subject, status, error ?? null, true);
}

async function write(
	subject: TaskSubject,
	status: EnrichmentStatus,
	error: string | null,
	onlyIfRunning: boolean,
): Promise<void> {
	const data = {
		enrichmentStatus: status,
		enrichmentError: error,
		...(status === EnrichmentStatus.COMPLETE ? { enrichedAt: new Date() } : {}),
	};

	const guard = onlyIfRunning
		? { enrichmentStatus: EnrichmentStatus.RUNNING }
		: {};

	// `updateMany` for the status guard, and because a row can be deleted
	// between the dispatch and the session parking — a `update` would throw on
	// a record the rep removed while the agent was still reading about it.
	if (subject.contactId) {
		await db.contact.updateMany({
			where: { id: subject.contactId, ...guard },
			data,
		});
	}

	if (subject.companyId) {
		await db.company.updateMany({
			where: { id: subject.companyId, ...guard },
			data,
		});
	}
}
