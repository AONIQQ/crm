import { db } from "@crm/db";
import { capabilitiesMarkdown } from "./capabilities";

export type Opened = {
	dispatched: boolean;
	kind?: string | null;
	reason?: string | null;
	budget?: number | null;
};

export type Preamble = {
	markdown: string;
	focus: { contactId?: string | null; companyId?: string | null };
};

export async function sessionPreamble(
	record: {
		contactId?: string | null;
		companyId?: string | null;
		dealId?: string | null;
	},
	opened: Opened,
): Promise<Preamble> {
	if (record.contactId) return contactPreamble(record.contactId, opened);
	if (record.companyId) return companyPreamble(record.companyId, opened);
	if (record.dealId) return dealPreamble(record.dealId, opened);
	return noRecordPreamble();
}

function opening(opened: Opened, questions: string): string {
	if (opened.dispatched) {
		return [
			"This session was started by the dispatcher, not by a person. Nobody is",
			"waiting on a reply — do the work, record what you find, and stop.",
		].join(" ");
	}

	return [
		"**A rep has this record open and is talking to you.** Answer what they",
		`actually asked — usually some form of ${questions} — from what the CRM`,
		"already holds, and say plainly when we do not know something. Research it",
		"further only if the answer needs it or they ask you to. Never ask them for",
		"an id, a name or an address you can look up yourself.",
	].join(" ");
}

export async function contactPreamble(
	contactId: string,
	opened: Opened,
): Promise<Preamble> {
	const contact = await db.contact.findUnique({
		where: { id: contactId },
		select: {
			firstName: true,
			lastName: true,
			email: true,
			title: true,
			company: { select: { id: true, name: true, domain: true } },
			brief: { select: { refreshedAt: true } },
			deals: {
				orderBy: { deal: { lastActivityAt: "desc" } },
				take: 5,
				select: {
					role: true,
					deal: { select: { id: true, name: true, stage: true } },
				},
			},
			_count: { select: { emailThreads: true, calendarEvents: true } },
		},
	});

	if (!contact) {
		return { markdown: capabilitiesMarkdown(), focus: { contactId } };
	}

	const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");

	const known =
		contact._count.emailThreads > 0 || contact._count.calendarEvents > 0
			? `We have ${contact._count.emailThreads} thread(s) and ${contact._count.calendarEvents} meeting(s) with them — read those first.`
			: "We have never corresponded with them, so there is nothing internal to go on.";

	const deals = contact.deals
		.map(
			({ role, deal }) =>
				`${deal.name} (${deal.stage}${role ? `, ${role}` : ""}) \`${deal.id}\``,
		)
		.join("; ");

	const markdown = [
		"## This session",
		"",
		`You are working on **${name}** (\`${contactId}\`)${
			contact.email ? `, ${contact.email}` : ""
		}${contact.title ? `, ${contact.title}` : ""}.`,
		opened.kind ? `Task: **${opened.kind}**.` : "",
		opened.reason ? `Why now: ${opened.reason}` : "",
		opened.budget
			? `Budget: **${opened.budget}** vendor calls. Spend them where they matter.`
			: "",
		"",
		opening(
			opened,
			"who this person is, whether they are still there, or what to know before a call",
		),
		"",
		contact.company
			? `They work at **${contact.company.name}**${
					contact.company.domain ? ` (${contact.company.domain})` : ""
				}, company id \`${contact.company.id}\` — pass that straight to \`read_company_history\`, \`enrich_company\` or \`research_company\` when the question reaches past this one person.`
			: "They are not attached to a company. `search_crm` will find one by name or domain if the conversation needs it.",
		deals ? `They are on: ${deals}.` : "They are not on any deal.",
		"",
		known,
		contact.brief
			? `A background already exists, written ${contact.brief.refreshedAt.toDateString()}. Replace it only if you learn something it does not say.`
			: "There is no background on them yet.",
		"",
		"Start with `read_crm_history` on this contact id.",
		"",
		capabilitiesMarkdown(),
	]
		.filter(Boolean)
		.join("\n");

	return {
		markdown,
		focus: { contactId, companyId: contact.company?.id ?? null },
	};
}

export async function companyPreamble(
	companyId: string,
	opened: Opened,
): Promise<Preamble> {
	const company = await db.company.findUnique({
		where: { id: companyId },
		select: {
			name: true,
			domain: true,
			industry: true,
			description: true,
			contacts: {
				orderBy: [{ lastActivityAt: "desc" }, { createdAt: "asc" }],
				take: 12,
				select: { id: true, firstName: true, lastName: true, title: true },
			},
			deals: {
				orderBy: [{ lastActivityAt: "desc" }, { createdAt: "desc" }],
				take: 8,
				select: { id: true, name: true, stage: true },
			},
			_count: { select: { contacts: true } },
		},
	});

	if (!company) {
		return { markdown: capabilitiesMarkdown(), focus: { companyId } };
	}

	const people = company.contacts
		.map((person) => {
			const name = [person.firstName, person.lastName]
				.filter(Boolean)
				.join(" ");
			return `- ${name}${person.title ? ` — ${person.title}` : ""} \`${person.id}\``;
		})
		.join("\n");

	const more =
		company._count.contacts > company.contacts.length
			? `\n- …and ${company._count.contacts - company.contacts.length} more; \`read_company_history\` lists them all.`
			: "";

	const deals = company.deals
		.map((deal) => `${deal.name} (${deal.stage}) \`${deal.id}\``)
		.join("; ");

	const markdown = [
		"## This session",
		"",
		`You are working on **${company.name}**${
			company.domain ? ` (${company.domain})` : ""
		}${company.industry ? `, ${company.industry}` : ""} — company id \`${companyId}\`.`,
		"",
		opening(
			opened,
			"what this company does, who we know there, or what has changed recently",
		),
		"",
		people
			? `### Who we know there (${company._count.contacts})\n\n${people}${more}\n\nThose are contact ids. Use them directly — with \`read_crm_history\`, \`identify_contact\` or \`record_fact\`. Never ask a rep which contact they mean without naming these first.`
			: "We have no contacts on file here yet.",
		"",
		deals ? `Deals: ${deals}.` : "There are no deals here.",
		company.description
			? "There is already a description on the record."
			: "There is no description on the record yet.",
		"",
		"Start with `read_company_history` on this company id — it returns the people, the deals, the correspondence and the notes in one free call.",
		"",
		capabilitiesMarkdown(),
	]
		.filter(Boolean)
		.join("\n");

	return { markdown, focus: { companyId } };
}

export async function dealPreamble(
	dealId: string,
	opened: Opened,
): Promise<Preamble> {
	const deal = await db.deal.findUnique({
		where: { id: dealId },
		select: {
			name: true,
			stage: true,
			amount: true,
			currency: true,
			expectedCloseDate: true,
			lastActivityAt: true,
			company: { select: { id: true, name: true } },
			contacts: {
				select: {
					role: true,
					contact: {
						select: { id: true, firstName: true, lastName: true, title: true },
					},
				},
			},
		},
	});

	if (!deal) return { markdown: capabilitiesMarkdown(), focus: {} };

	const people = deal.contacts
		.map(({ role, contact }) => {
			const name = [contact.firstName, contact.lastName]
				.filter(Boolean)
				.join(" ");
			return `${name}${contact.title ? ` (${contact.title})` : ""}${
				role ? ` — ${role}` : ""
			} \`${contact.id}\``;
		})
		.join("; ");

	const markdown = [
		"## This session",
		"",
		`You are working on the deal **${deal.name}**${
			deal.company ? ` at ${deal.company.name}` : ""
		} — deal id \`${dealId}\`${
			deal.company ? `, company id \`${deal.company.id}\`` : ""
		}.`,
		`Stage: **${deal.stage}**${
			deal.amount
				? `. Amount: ${deal.amount} ${deal.currency ?? ""}`.trim()
				: ""
		}${
			deal.expectedCloseDate
				? `. Expected close: ${deal.expectedCloseDate.toDateString()}`
				: ""
		}.`,
		deal.lastActivityAt
			? `Last touched ${deal.lastActivityAt.toDateString()}.`
			: "Nothing has happened on it yet.",
		people ? `People on it: ${people}` : "Nobody is attached to it yet.",
		"",
		opening(
			opened,
			"where this stands, who else should be involved, or what the risk is",
		),
		"",
		"Start with `read_deal_history` on this deal id. It returns the stage clock, every stage this deal has moved through, the last reply from their side and the next meeting — which is how you answer *where does this stand* rather than reciting the stage field back.",
		"",
		"You can research the people and the company behind it with the usual tools — a deal itself has no fields to enrich, so anything you learn is recorded against them.",
		"",
		capabilitiesMarkdown(),
	].join("\n");

	return { markdown, focus: { companyId: deal.company?.id ?? null } };
}

export function noRecordPreamble(): Preamble {
	return {
		markdown: [
			"## This session",
			"",
			"No record was named, so nothing is in focus yet.",
			"`list_outstanding_work` shows contacts with research outstanding, and",
			"`search_crm` finds any contact, company or deal by name, email address or",
			"domain. Look the record up rather than asking for an id.",
			"",
			capabilitiesMarkdown(),
		].join("\n"),
		focus: {},
	};
}
