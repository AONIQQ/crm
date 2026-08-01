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
			const budget = asNumber(attributes.budget);
			const reason = asString(attributes.reason);
			const kind = asString(attributes.taskKind);

			// Which outside sources exist is a property of the install, not of the
			// task, so it is stated even for a session that is not about anybody in
			// particular. An agent that learns its limits from four failed tool
			// calls has already spent the budget it needed for the work.
			if (!contactId) {
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
