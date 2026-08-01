import { db } from "@crm/db";
import { defineDynamic, defineInstructions } from "eve/instructions";
import { capabilitiesMarkdown } from "../lib/capabilities";
import { focusOn, setBudget } from "../lib/focus";

/**
 * What this particular session is for.
 *
 * `instructions.md` is the agent's permanent identity and is the same every
 * time. This is the opposite: resolved once per session from whoever started
 * it, so a run dispatched for one contact opens already knowing who they are,
 * what the task is, and what it may spend — instead of spending its first two
 * tool calls finding out.
 *
 * Resolved at `session.started` rather than per turn. Prompt caches are keyed
 * on the prompt, so a preamble that changed every turn would re-ingest the
 * whole conversation at uncached prices for information that does not change.
 */
export default defineDynamic({
	events: {
		"session.started": async (_event, ctx) => {
			const attributes = ctx.session.auth.current?.attributes ?? {};
			const contactId = asString(attributes.contactId);
			const companyId = asString(attributes.companyId);
			const dealId = asString(attributes.dealId);
			const budget = asNumber(attributes.budget);
			const reason = asString(attributes.reason);
			const kind = asString(attributes.taskKind);

			// Which outside sources exist is a property of the install, not of the
			// task, so it is stated even for a session that is not about anybody in
			// particular. An agent that learns its limits from four failed tool
			// calls has already spent the budget it needed for the work.
			// The panel opens on three kinds of record, and each is a different
			// conversation. A session about a deal that opens by describing a
			// person is a session that has to be told what it is looking at before
			// it can be useful.
			if (!contactId) {
				if (companyId) {
					return defineInstructions({
						markdown: await companyMarkdown(companyId, ctx.session.id),
					});
				}
				if (dealId) {
					return defineInstructions({
						markdown: await dealMarkdown(dealId, ctx.session.id),
					});
				}
				return defineInstructions({ markdown: capabilitiesMarkdown() });
			}

			// Seeding the session state here is what lets the audit hook file every
			// event against the right record — a hook sees events, not arguments.
			focusOn({ contactId, sessionId: ctx.session.id });
			if (budget) setBudget(budget);

			const contact = await db.contact.findUnique({
				where: { id: contactId },
				select: {
					firstName: true,
					lastName: true,
					email: true,
					title: true,
					company: { select: { name: true, domain: true } },
					brief: { select: { refreshedAt: true } },
					_count: { select: { emailThreads: true, calendarEvents: true } },
				},
			});

			if (!contact) {
				return defineInstructions({ markdown: capabilitiesMarkdown() });
			}

			const name = [contact.firstName, contact.lastName]
				.filter(Boolean)
				.join(" ");

			const known =
				contact._count.emailThreads > 0 || contact._count.calendarEvents > 0
					? `We have ${contact._count.emailThreads} thread(s) and ${contact._count.calendarEvents} meeting(s) with them — read those first.`
					: "We have never corresponded with them, so there is nothing internal to go on.";

			return defineInstructions({
				markdown: [
					"## This session",
					"",
					`You are working on **${name}** (\`${contactId}\`)${
						contact.email ? `, ${contact.email}` : ""
					}${contact.company?.name ? `, at ${contact.company.name}` : ""}.`,
					kind ? `Task: **${kind}**.` : "",
					reason ? `Why now: ${reason}` : "",
					budget
						? `Budget: **${budget}** vendor calls. Spend them where they matter.`
						: "",
					"",
					known,
					contact.brief
						? `A background already exists, written ${contact.brief.refreshedAt.toDateString()}. Replace it only if you learn something it does not say.`
						: "There is no background on them yet.",
					"",
					capabilitiesMarkdown(),
				]
					.filter(Boolean)
					.join("\n"),
			});
		},
	},
});

function asString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
	const parsed = typeof value === "string" ? Number(value) : value;
	return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

/**
 * A session opened from a company's record.
 *
 * Shorter than the contact preamble because a company has less to say about
 * itself: what it is, who we know there, and whether anyone has looked it up.
 */
async function companyMarkdown(
	companyId: string,
	sessionId: string,
): Promise<string> {
	focusOn({ companyId, sessionId });

	const company = await db.company.findUnique({
		where: { id: companyId },
		select: {
			name: true,
			domain: true,
			industry: true,
			description: true,
			enrichmentStatus: true,
			_count: { select: { contacts: true, deals: true } },
		},
	});

	if (!company) return capabilitiesMarkdown();

	return [
		"## This session",
		"",
		`You are working on **${company.name}**${
			company.domain ? ` (${company.domain})` : ""
		}${company.industry ? `, ${company.industry}` : ""}.`,
		`We know ${company._count.contacts} contact(s) and ${company._count.deals} deal(s) there.`,
		company.description
			? "There is already a description on the record."
			: "There is no description on the record yet.",
		"",
		capabilitiesMarkdown(),
	].join("\n");
}

/**
 * A session opened from a deal's record.
 *
 * A deal is the one record where the *state* matters as much as the facts:
 * which stage, how much, who is on it, and when it was last touched. Those are
 * the questions a rep opens a deal to ask, so they are what the session starts
 * knowing.
 */
async function dealMarkdown(
	dealId: string,
	sessionId: string,
): Promise<string> {
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

	if (!deal) return capabilitiesMarkdown();

	// Focused on the company, because that is the record every fact the agent
	// can write hangs off — a deal has no fields of its own to enrich.
	focusOn({ companyId: deal.company?.id ?? null, sessionId });

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

	return [
		"## This session",
		"",
		`You are working on the deal **${deal.name}**${
			deal.company ? ` at ${deal.company.name}` : ""
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
		"You can research the people and the company behind it with the usual",
		"tools — a deal itself has no fields to enrich, so anything you learn is",
		"recorded against them.",
		"",
		capabilitiesMarkdown(),
	].join("\n");
}
