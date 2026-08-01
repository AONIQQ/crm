import { db } from "@crm/db";
import { domainOf, nameMatchesLocalPart } from "./names";

/**
 * The CRM, as far as this agent is concerned.
 *
 * Straight to Postgres through the workspace package rather than through a new
 * internal HTTP API: `@crm/db` is already shared by the API and the app, and a
 * third caller does not justify inventing a service boundary.
 */

export type EnrichableContact = {
	id: string;
	email: string;
	firstName: string;
	lastName: string | null;
	title: string | null;
	companyName: string | null;
	companyDomain: string | null;
};

/**
 * Contacts worth spending a lookup on.
 *
 * Only ones whose name is still derived from their address — a name a human or
 * a mail header supplied is already better than anything research will find.
 */
export async function contactsNeedingResearch(
	limit: number,
): Promise<EnrichableContact[]> {
	const rows = await db.contact.findMany({
		where: {
			email: { not: null },
			source: { in: ["EMAIL", "CALENDAR"] },
		},
		select: {
			id: true,
			email: true,
			firstName: true,
			lastName: true,
			title: true,
			company: { select: { name: true, domain: true } },
		},
		orderBy: { createdAt: "desc" },
		take: limit * 4,
	});

	return rows
		.filter((row) => row.email !== null)
		.filter((row) => {
			const local = row.email?.split("@")[0] ?? "";
			// `nameMatchesLocalPart` is true for a real name too, so the test is
			// specifically "no surname and the first name is the whole handle".
			return (
				row.lastName === null &&
				nameMatchesLocalPart(
					{ firstName: row.firstName, lastName: null },
					local,
				)
			);
		})
		.slice(0, limit)
		.map((row) => ({
			id: row.id,
			email: row.email as string,
			firstName: row.firstName,
			lastName: row.lastName,
			title: row.title,
			companyName: row.company?.name ?? null,
			companyDomain: row.company?.domain ?? domainOf(row.email as string),
		}));
}

export type ContactPatch = {
	firstName?: string;
	lastName?: string | null;
	title?: string;
	linkedinUrl?: string;
};

/**
 * Applies a patch, refusing to overwrite anything a human filled in.
 *
 * Returns the fields it actually changed, so the agent is told what happened
 * rather than assuming its write landed.
 */
export async function patchContact(
	contactId: string,
	patch: ContactPatch,
): Promise<{ changed: string[] }> {
	const current = await db.contact.findUnique({
		where: { id: contactId },
		select: {
			email: true,
			firstName: true,
			lastName: true,
			title: true,
			linkedinUrl: true,
		},
	});

	if (!current?.email) return { changed: [] };

	const local = current.email.split("@")[0] ?? "";
	const derivedName =
		current.lastName === null &&
		nameMatchesLocalPart(
			{ firstName: current.firstName, lastName: null },
			local,
		);

	const data: ContactPatch = {};
	const changed: string[] = [];

	// The name may only be replaced while it is still the placeholder the sync
	// derived from the address.
	if (patch.firstName && derivedName) {
		data.firstName = patch.firstName;
		data.lastName = patch.lastName ?? null;
		changed.push("name");
	}

	// Everything else fills gaps only.
	if (patch.title && !current.title) {
		data.title = patch.title;
		changed.push("title");
	}
	if (patch.linkedinUrl && !current.linkedinUrl) {
		data.linkedinUrl = patch.linkedinUrl;
		changed.push("linkedinUrl");
	}

	if (changed.length === 0) return { changed: [] };

	await db.contact.update({ where: { id: contactId }, data });
	return { changed };
}

/** Writes a note onto the contact's timeline, stamped as agent-written. */
export async function writeTimelineNote(
	contactId: string,
	subject: string,
	body: string,
	meta: Record<string, unknown> = {},
): Promise<string | null> {
	const contact = await db.contact.findUnique({
		where: { id: contactId },
		select: { companyId: true, ownerId: true },
	});
	if (!contact) return null;

	// Activity.createdById is required. Attribute to the contact's owner, or to
	// any user if the contact is unowned — the meta marks it as agent-written so
	// the UI never claims a person typed it.
	const author =
		contact.ownerId ??
		(await db.user.findFirst({ select: { id: true } }))?.id ??
		null;
	if (!author) return null;

	const activity = await db.activity.create({
		data: {
			type: "NOTE",
			subject,
			body,
			occurredAt: new Date(),
			contactId,
			companyId: contact.companyId,
			createdById: author,
			meta: { ...meta, agent: "people-research" },
		},
		select: { id: true },
	});

	return activity.id;
}
