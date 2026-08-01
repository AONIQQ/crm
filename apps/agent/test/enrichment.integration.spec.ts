import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { db, EnrichmentStatus } from "@crm/db";
import { markRunning, settle } from "../agent/lib/enrichment";

/**
 * The status a rep reads off the record, against a real database.
 *
 * Worth pinning because the bug it replaces was invisible: `enrichmentStatus`
 * defaults to PENDING, nothing on the contact path ever wrote it, and the sheet
 * rendered PENDING as "Queued". Every contact in the database therefore claimed
 * to be queued from the moment it was inserted, and no test failed.
 */

const domain = "lifecycle.example.test";

async function clear() {
	await db.company.deleteMany({ where: { domain } });
	await db.contact.deleteMany({
		where: { email: { startsWith: "lifecycle-" } },
	});
}

beforeEach(clear);
afterEach(clear);

async function company() {
	return db.company.create({
		data: { name: "Lifecycle", domain },
		select: { id: true },
	});
}

async function contact() {
	return db.contact.create({
		data: {
			firstName: "Lifecycle",
			email: `lifecycle-${crypto.randomUUID()}@example.test`,
		},
		select: { id: true },
	});
}

function subjectOf(ids: { contactId?: string; companyId?: string }) {
	return {
		id: "task",
		kind: "test",
		contactId: ids.contactId ?? null,
		companyId: ids.companyId ?? null,
	};
}

async function statusOfContact(id: string) {
	const row = await db.contact.findUnique({
		where: { id },
		select: { enrichmentStatus: true, enrichedAt: true },
	});
	return row;
}

describe("the record follows the task", () => {
	it("takes a contact off PENDING, which nothing used to do", async () => {
		const person = await contact();
		const subject = subjectOf({ contactId: person.id });

		expect((await statusOfContact(person.id))?.enrichmentStatus).toBe(
			"PENDING",
		);

		await markRunning(subject);
		expect((await statusOfContact(person.id))?.enrichmentStatus).toBe(
			"RUNNING",
		);

		await settle(subject, EnrichmentStatus.COMPLETE);
		const done = await statusOfContact(person.id);
		expect(done?.enrichmentStatus).toBe("COMPLETE");
		// The sheet shows this, so a COMPLETE with no date would read as enriched
		// at the beginning of time.
		expect(done?.enrichedAt).not.toBeNull();
	});

	it("does the same for a company", async () => {
		const org = await company();
		const subject = subjectOf({ companyId: org.id });

		await markRunning(subject);
		await settle(subject, EnrichmentStatus.COMPLETE);

		const row = await db.company.findUnique({
			where: { id: org.id },
			select: { enrichmentStatus: true },
		});
		expect(row?.enrichmentStatus).toBe("COMPLETE");
	});

	it("lets a tool's more specific answer win over the queue's", async () => {
		const org = await company();
		const subject = subjectOf({ companyId: org.id });

		await markRunning(subject);

		// What `enrich_company` does when there is no domain to look up: a
		// terminal answer, with a reason a rep can read.
		await db.company.update({
			where: { id: org.id },
			data: {
				enrichmentStatus: EnrichmentStatus.SKIPPED,
				enrichmentError: "No domain to look up.",
			},
		});

		// The turn then parks and the task settles. It must not flatten that into
		// COMPLETE and throw away the message.
		await settle(subject, EnrichmentStatus.COMPLETE);

		const row = await db.company.findUnique({
			where: { id: org.id },
			select: { enrichmentStatus: true, enrichmentError: true },
		});
		expect(row?.enrichmentStatus).toBe("SKIPPED");
		expect(row?.enrichmentError).toBe("No domain to look up.");
	});

	it("puts a failed record back to work on a retry", async () => {
		const person = await contact();
		const subject = subjectOf({ contactId: person.id });

		await markRunning(subject);
		await settle(subject, EnrichmentStatus.FAILED, "the vendor refused");
		expect((await statusOfContact(person.id))?.enrichmentStatus).toBe("FAILED");

		// A retry is genuinely running again. Gating this on the previous status
		// would strand the record on FAILED with a session actively working on it.
		await markRunning(subject);
		const retried = await statusOfContact(person.id);
		expect(retried?.enrichmentStatus).toBe("RUNNING");

		const row = await db.contact.findUnique({
			where: { id: person.id },
			select: { enrichmentError: true },
		});
		expect(row?.enrichmentError).toBeNull();
	});

	it("survives a record deleted while the agent was still reading about it", async () => {
		const person = await contact();
		const subject = subjectOf({ contactId: person.id });

		await markRunning(subject);
		await db.contact.delete({ where: { id: person.id } });

		// `update` would throw here and take the dispatcher tick with it.
		await settle(subject, EnrichmentStatus.COMPLETE);
	});
});
