import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db, RecordSource } from "@crm/db";
import { AgentQueueService } from "../src/agent/agent-queue.service";
import { AgentTriggerService } from "../src/agent/agent-trigger.service";
import { CompaniesService } from "../src/companies/companies.service";
import { CompanyDirectoryService } from "../src/companies/company-directory.service";
import { FaviconService } from "../src/companies/favicon.service";
import { ContactsService } from "../src/contacts/contacts.service";
import { ActivityStampService } from "../src/crm/activity-stamp.service";
import { EnrichmentLogService } from "../src/crm/enrichment-log.service";
import { GoogleMatchService } from "../src/google/google-match.service";

const suffix = process.env.TEST_RUN_ID ?? "record-delete-spec";
const domain = `delete-${suffix}.test`;
const doomedDomain = `doomed-${suffix}.test`;
const email = `gone@${domain}`;
const colleague = `stays@${domain}`;
const userId = `user-${suffix}`;

const stamp = new ActivityStampService(db);
const agent = new AgentTriggerService(db);
const directory = new CompanyDirectoryService(db, agent);
const log = new EnrichmentLogService(db, stamp);
const queue = new AgentQueueService(db);

const contacts = new ContactsService(db, directory, agent, queue, stamp);
const companies = new CompaniesService(
	db,
	agent,
	queue,
	{ backfill: async () => undefined } as unknown as FaviconService,
	stamp,
);
const match = new GoogleMatchService(db, directory, agent, log);

async function matchContext() {
	const internal = await match.internalIdentity();
	return {
		ourAddresses: internal.addresses,
		ourDomains: internal.domains,
		suppressedDomains: await match.suppressedDomains(),
		suppressedEmails: await match.suppressedEmails(),
	};
}

async function clean() {
	const domains = [domain, doomedDomain];
	await db.contact.deleteMany({
		where: { OR: domains.map((host) => ({ email: { endsWith: `@${host}` } })) },
	});
	await db.company.deleteMany({ where: { domain: { in: domains } } });
	await db.suppressedContact.deleteMany({
		where: { OR: domains.map((host) => ({ email: { endsWith: `@${host}` } })) },
	});
	await db.user.deleteMany({ where: { id: userId } });
}

beforeAll(async () => {
	await clean();
	await db.user.create({
		data: { id: userId, name: "Test Rep", email: `${userId}@example.test` },
	});
});

afterAll(clean);

describe("deleting a contact", () => {
	let contactId: string;

	it("takes the record, its queued research and its transcript with it", async () => {
		const created = await contacts.create({
			firstName: "Gone",
			lastName: "Person",
			email,
			ownerId: userId,
		});
		contactId = created.id;

		await db.agentEvent.create({
			data: {
				id: `evt-${suffix}`,
				sessionId: `ses-${suffix}`,
				contactId,
				type: "session.started",
				data: {},
				emittedAt: new Date(),
			},
		});

		expect(await contacts.delete(contactId)).toEqual({
			id: contactId,
			name: "Gone Person",
		});

		expect(
			await db.contact.findUnique({ where: { id: contactId } }),
		).toBeNull();
		expect(await db.agentTask.count({ where: { contactId } })).toBe(0);
		expect(await db.agentEvent.count({ where: { contactId } })).toBe(0);
	});

	it("remembers the address so the sync cannot bring them back", async () => {
		const suppressed = await db.suppressedContact.findUnique({
			where: { email },
		});
		expect(suppressed).not.toBeNull();

		const result = await match.resolve(
			{
				participants: [{ email, name: "Gone Person" }],
				allowCreate: true,
				source: RecordSource.EMAIL,
				ownerId: userId,
			},
			await matchContext(),
		);

		expect(result.external).toEqual([]);
		expect(result.contactId).toBeNull();
		expect(await db.contact.findFirst({ where: { email } })).toBeNull();
	});

	it("still files the colleagues who were not deleted", async () => {
		const result = await match.resolve(
			{
				participants: [
					{ email, name: "Gone Person" },
					{ email: colleague, name: "Stays Here" },
				],
				allowCreate: true,
				source: RecordSource.EMAIL,
				ownerId: userId,
			},
			await matchContext(),
		);

		expect(result.external.map((person) => person.email)).toEqual([colleague]);

		const created = await db.contact.findFirst({ where: { email: colleague } });
		expect(created?.id).toBe(result.contactId ?? undefined);
	});

	it("lets a rep add them back by hand, which lifts the suppression", async () => {
		const readded = await contacts.create({ firstName: "Gone", email });

		expect(
			await db.suppressedContact.findUnique({ where: { email } }),
		).toBeNull();

		await db.contact.delete({ where: { id: readded.id } });
		await db.suppressedContact.deleteMany({ where: { email } });
	});
});

describe("deleting a company", () => {
	it("takes its deals and leaves its people without a company", async () => {
		const company = await companies.create({
			name: "Doomed",
			domain: doomedDomain,
		});
		const contact = await contacts.create({
			firstName: "Left",
			lastName: "Behind",
			email: `left@${doomedDomain}`,
			companyId: company.id,
		});
		const deal = await db.deal.create({
			data: { name: "Doomed deal", companyId: company.id, ownerId: userId },
			select: { id: true },
		});

		expect(await companies.delete(company.id)).toEqual({
			id: company.id,
			name: "Doomed",
		});

		expect(await db.deal.findUnique({ where: { id: deal.id } })).toBeNull();
		expect(await db.agentTask.count({ where: { companyId: company.id } })).toBe(
			0,
		);

		const survivor = await db.contact.findUnique({
			where: { id: contact.id },
			select: { companyId: true },
		});
		expect(survivor?.companyId).toBeNull();

		await db.contact.delete({ where: { id: contact.id } });
	});
});
