import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { DealStage, db } from "@crm/db";
import {
	companyPreamble,
	contactPreamble,
	dealPreamble,
	noRecordPreamble,
	sessionPreamble,
} from "../agent/lib/preamble";

const suffix = process.env.TEST_RUN_ID ?? "preamble-spec";
const domain = `fernhill-${suffix}.test`;

let companyId: string;
let dealId: string;
let paulaId: string;
let tomiId: string;

const rep = { dispatched: false };

beforeAll(async () => {
	await cleanup();

	const user = await db.user.create({
		data: {
			id: `user-${suffix}`,
			name: "Rep One",
			email: `rep.${suffix}@example.test`,
			emailVerified: true,
		},
		select: { id: true },
	});

	const company = await db.company.create({
		data: {
			name: `Fernhill Systems ${suffix}`,
			domain,
			industry: "Security software",
		},
		select: { id: true },
	});
	companyId = company.id;

	const paula = await db.contact.create({
		data: {
			firstName: "Paula",
			lastName: "Marchetti",
			title: "Growth Specialist",
			email: `paula.marchetti@${domain}`,
			companyId,
			lastActivityAt: new Date(),
		},
		select: { id: true },
	});
	paulaId = paula.id;

	const tomi = await db.contact.create({
		data: {
			firstName: "Tomi",
			lastName: "Okonkwo",
			title: "Head of Security",
			email: `tomi.okonkwo@${domain}`,
			companyId,
		},
		select: { id: true },
	});
	tomiId = tomi.id;

	const deal = await db.deal.create({
		data: {
			name: `Fernhill platform ${suffix}`,
			companyId,
			ownerId: user.id,
			stage: DealStage.CONTRACT_SENT,
			amount: 48_000,
			contacts: { create: [{ contactId: paulaId, role: "Champion" }] },
		},
		select: { id: true },
	});
	dealId = deal.id;
});

afterAll(cleanup);

async function cleanup(): Promise<void> {
	const company = await db.company.findFirst({
		where: { domain },
		select: { id: true },
	});

	if (company) {
		await db.activity.deleteMany({ where: { companyId: company.id } });
		await db.deal.deleteMany({ where: { companyId: company.id } });
		await db.contact.deleteMany({ where: { companyId: company.id } });
		await db.company.delete({ where: { id: company.id } });
	}

	await db.user.deleteMany({ where: { email: `rep.${suffix}@example.test` } });
}

describe("companyPreamble", () => {
	it("names every contact it lists, with their id", async () => {
		const { markdown } = await companyPreamble(companyId, rep);

		expect(markdown).toContain(
			`Paula Marchetti — Growth Specialist \`${paulaId}\``,
		);
		expect(markdown).toContain(`Tomi Okonkwo — Head of Security \`${tomiId}\``);
		expect(markdown).toContain("Never ask a rep which contact they mean");
	});

	it("carries the deals and the company's own id", async () => {
		const { markdown, focus } = await companyPreamble(companyId, rep);

		expect(markdown).toContain(`company id \`${companyId}\``);
		expect(markdown).toContain(`(CONTRACT_SENT) \`${dealId}\``);
		expect(focus).toEqual({ companyId });
	});

	it("points at the company read, not the contact one", async () => {
		const { markdown } = await companyPreamble(companyId, rep);

		expect(markdown).toContain("Start with `read_company_history`");
	});
});

describe("contactPreamble", () => {
	it("states the company id, not just its name", async () => {
		const { markdown, focus } = await contactPreamble(paulaId, rep);

		expect(markdown).toContain(`company id \`${companyId}\``);
		expect(focus).toEqual({ contactId: paulaId, companyId });
	});

	it("lists the deals they are on", async () => {
		const { markdown } = await contactPreamble(paulaId, rep);

		expect(markdown).toContain(`(CONTRACT_SENT, Champion) \`${dealId}\``);
	});

	it("offers a way out when they have no company", async () => {
		const orphan = await db.contact.create({
			data: { firstName: "Nobody", email: `nobody.${suffix}@example.test` },
			select: { id: true },
		});

		const { markdown } = await contactPreamble(orphan.id, rep);
		expect(markdown).toContain("`search_crm` will find one");

		await db.contact.delete({ where: { id: orphan.id } });
	});
});

describe("dealPreamble", () => {
	it("carries the deal, the company and the people, all with ids", async () => {
		const { markdown, focus } = await dealPreamble(dealId, rep);

		expect(markdown).toContain(`deal id \`${dealId}\``);
		expect(markdown).toContain(`company id \`${companyId}\``);
		expect(markdown).toContain(`Champion \`${paulaId}\``);
		expect(focus).toEqual({ companyId });
	});
});

describe("who opened the session", () => {
	it("tells a rep's session to answer the question", async () => {
		const { markdown } = await companyPreamble(companyId, {
			dispatched: false,
		});

		expect(markdown).toContain("A rep has this record open");
		expect(markdown).not.toContain("Nobody is waiting on a reply");
	});

	it("tells a dispatched session to do the work and stop", async () => {
		const { markdown } = await companyPreamble(companyId, {
			dispatched: true,
			kind: "identity",
		});

		expect(markdown).toContain("Nobody is waiting on a reply");
		expect(markdown).not.toContain("A rep has this record open");
	});
});

describe("sessionPreamble", () => {
	it("routes each record kind to its own conversation", async () => {
		const contact = await sessionPreamble({ contactId: paulaId }, rep);
		const company = await sessionPreamble({ companyId }, rep);
		const deal = await sessionPreamble({ dealId }, rep);

		expect(contact.markdown).toContain("Start with `read_crm_history`");
		expect(company.markdown).toContain("Start with `read_company_history`");
		expect(deal.markdown).toContain("Start with `read_deal_history`");
	});

	it("prefers the contact when a session carries more than one id", async () => {
		const { markdown } = await sessionPreamble(
			{ contactId: paulaId, companyId, dealId },
			rep,
		);

		expect(markdown).toContain("Start with `read_crm_history`");
	});

	it("tells a session with no record that the CRM is searchable", async () => {
		const { markdown } = await sessionPreamble({}, rep);

		expect(markdown).toBe(noRecordPreamble().markdown);
		expect(markdown).toContain("`search_crm`");
	});
});
