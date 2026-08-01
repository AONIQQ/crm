import { db } from "@crm/db";
import { ActivityStampService } from "../src/crm/activity-stamp.service";
import { EnrichmentLogService } from "../src/crm/enrichment-log.service";
import { AvatarService } from "../src/enrichment/avatar.service";
import {
	looksLikeSameCompany,
	nameMatchesLocalPart,
	searchTerms,
} from "../src/enrichment/contact-enrichment.service";
import { LinkdapiClient } from "../src/enrichment/linkdapi.client";

/**
 * Fills in every contact we can identify, once.
 *
 * `ContactEnrichmentService` deliberately only touches contacts whose name is
 * still derived from their address — that is the right rule for the ongoing
 * sync, because a name a human typed should never be second-guessed. It does
 * mean a contact who already had a real name never gets a photo or a title.
 *
 * This is the backfill for that gap: it skips the name unless it is a
 * placeholder, and fills the empty fields for everybody else. Re-running is
 * safe — every write is gap-filling, so a second pass changes nothing.
 *
 *   bun run scripts/reenrich-contacts.ts
 */

const rapidKey = process.env.RAPIDAPI_KEY;
const pplxKey = process.env.PERPLEXITY_API_KEY;
if (!rapidKey || !pplxKey) {
	throw new Error("RAPIDAPI_KEY and PERPLEXITY_API_KEY are both required.");
}

const linkedin = new LinkdapiClient({
	get: (name: string) => process.env[name],
} as never);
const avatars = new AvatarService();
const log = new EnrichmentLogService(
	db as never,
	new ActivityStampService(db as never),
);

/** Perplexity, restricted to LinkedIn, for the slug we cannot already read. */
async function resolveSlug(email: string, company: string): Promise<string[]> {
	const slugs: string[] = [];

	for (const term of searchTerms(email.split("@")[0] ?? "")) {
		const response = await fetch("https://api.perplexity.ai/chat/completions", {
			method: "POST",
			headers: {
				authorization: `Bearer ${pplxKey}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				model: "sonar",
				search_domain_filter: ["linkedin.com"],
				messages: [
					{
						role: "user",
						content: `Find the LinkedIn profile of "${term}" who works at ${company}. Reply with the profile URL only.`,
					},
				],
			}),
		});

		if (!response.ok) continue;

		const body = (await response.json()) as {
			choices?: { message?: { content?: string } }[];
			citations?: string[];
			search_results?: { url?: string }[];
		};

		const haystack = [
			body.choices?.[0]?.message?.content ?? "",
			...(body.citations ?? []),
			...(body.search_results ?? []).map((r) => r.url ?? ""),
		].join(" ");

		for (const match of haystack.matchAll(
			/linkedin\.com\/in\/([A-Za-z0-9\-_%]+)/g,
		)) {
			const slug = match[1];
			if (slug && !slugs.includes(slug)) slugs.push(slug);
		}

		if (slugs.length > 0) break;
	}

	return slugs;
}

const contacts = await db.contact.findMany({
	where: { email: { not: null } },
	select: {
		id: true,
		firstName: true,
		lastName: true,
		email: true,
		title: true,
		linkedinUrl: true,
		imageUrl: true,
		company: { select: { name: true, domain: true } },
	},
	orderBy: { email: "asc" },
});

console.log(`${contacts.length} contacts with an email\n`);

let identified = 0;
let photos = 0;

for (const contact of contacts) {
	const email = contact.email as string;
	const local = email.split("@")[0] ?? "";
	const company = contact.company?.name ?? "";
	const domain = contact.company?.domain ?? email.split("@")[1] ?? "";

	// A stored profile URL is a slug we already paid for — no need to search.
	const known = contact.linkedinUrl?.match(/linkedin\.com\/in\/([^/?#]+)/)?.[1];
	const candidates = known ? [known] : await resolveSlug(email, company);

	let matched = false;

	for (const slug of candidates.slice(0, 3)) {
		const result = await linkedin.profile(slug);
		if (result.outcome !== "found") continue;

		const person = result.data;

		// A slug we already stored has been verified once; a fresh one has not.
		if (!known) {
			const employer = person.positions.some((position) =>
				looksLikeSameCompany(position.name, company, domain),
			);
			if (!employer || !nameMatchesLocalPart(person, local)) continue;
		}

		const placeholder =
			contact.lastName === null &&
			nameMatchesLocalPart(
				{ firstName: contact.firstName, lastName: null },
				local,
			);

		const imageUrl = person.pictureUrl
			? await avatars.mirror(person.pictureUrl, contact.id)
			: null;

		const data: Record<string, unknown> = {};
		if (placeholder && person.fullName) {
			const [first, ...rest] = person.fullName.split(" ");
			data.firstName = first;
			data.lastName = rest.length ? rest.join(" ") : null;
		}
		if (!contact.title && person.headline) data.title = person.headline;
		if (!contact.linkedinUrl) data.linkedinUrl = person.profileUrl;
		if (!contact.imageUrl && imageUrl) data.imageUrl = imageUrl;

		if (Object.keys(data).length > 0) {
			await db.contact.update({ where: { id: contact.id }, data });
			await log.record({
				contactId: contact.id,
				subject: "Enriched from LinkedIn",
				body: `Matched to ${person.fullName ?? slug}${person.headline ? `, ${person.headline}` : ""}.\n${person.profileUrl}`,
				meta: {
					source: "linkedin",
					sourceUrl: person.profileUrl,
					filled: Object.keys(data),
				},
			});
		}

		if (imageUrl) photos += 1;
		matched = true;
		identified += 1;

		const name =
			`${data.firstName ?? contact.firstName} ${data.lastName ?? contact.lastName ?? ""}`.trim();
		console.log(
			`✓ ${name.padEnd(18)} ${Object.keys(data).join(", ") || "already complete"}`,
		);
		break;
	}

	if (!matched)
		console.log(`· ${contact.firstName.padEnd(18)} no confident match`);
}

console.log(
	`\n${identified}/${contacts.length} identified, ${photos} photos stored.`,
);
await db.$disconnect();
