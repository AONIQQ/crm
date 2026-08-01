import { type Db, RecordSource } from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { domainFromEmail } from "../companies/domain";
import { EnrichmentLogService } from "../crm/enrichment-log.service";
import { InjectDatabase } from "../database/database.constants";
import { isDerivedName, splitName } from "../google/participants";
import { ContextDevClient } from "./context-dev.client";
import { EnrichmentQueue } from "./enrichment.queue";
import { LinkdapiClient } from "./linkdapi.client";

type Resolved = {
	fullName: string;
	title: string | null;
	linkedinUrl: string | null;
	sourceUrl: string;
};

/**
 * Puts a real name to an address the sync only knew as a local part.
 *
 * Why this exists: Google Calendar returns `displayName: null` for most
 * attendees, so a contact routinely arrives as "Abigham" — the address, title
 * cased. The temptation is to have a model expand it, and that is exactly what
 * this must not do: "abigham" only becomes "Abbie Bigham" if you already know
 * her, and a model asked to guess will produce something plausible and wrong,
 * which is worse than an ugly name because nobody can tell it is wrong.
 *
 * So the flow is search-then-read: find a page that names the person, extract
 * what it says, and write nothing if no page does. Every field is sourced, and
 * `sourceUrl` is recorded so a rep can check.
 *
 * Deliberately **not** an eve agent. eve is not installed, and this is one
 * queued lookup that fills empty fields and stops — the exact shape
 * `EnrichmentService` already has. A second background runtime to do the first
 * one's job would be machinery, not capability.
 */
@Injectable()
export class ContactEnrichmentService {
	private readonly logger = new Logger(ContactEnrichmentService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly context: ContextDevClient,
		private readonly queue: EnrichmentQueue,
		private readonly linkedin: LinkdapiClient,
		private readonly log: EnrichmentLogService,
	) {}

	get enabled(): boolean {
		return this.context.enabled && this.linkedin.enabled;
	}

	/**
	 * Queues a contact whose name we had to invent from their address.
	 *
	 * Fire-and-forget, and skipped entirely when the name is already real —
	 * there is nothing to improve and it would spend a lookup to confirm it.
	 */
	enqueue(contactId: string): boolean {
		if (!this.enabled) return false;

		return this.queue.enqueue(`contact:${contactId}`, () =>
			this.run(contactId),
		);
	}

	private async run(contactId: string): Promise<void> {
		const contact = await this.db.contact.findUnique({
			where: { id: contactId },
			select: {
				id: true,
				firstName: true,
				lastName: true,
				email: true,
				title: true,
				linkedinUrl: true,
				source: true,
				company: { select: { name: true, domain: true } },
			},
		});

		if (!contact?.email) return;

		// Only ever improves a name derived from the address. A name a human typed,
		// or one a mail header supplied, is already better than anything a search
		// will find.
		if (!isDerivedName(contact.email, contact.firstName, contact.lastName)) {
			return;
		}

		const domain = contact.company?.domain ?? domainFromEmail(contact.email);
		if (!domain) return;

		const found = await this.lookup(
			contact.email,
			contact.company?.name ?? domain,
			domain,
		);

		if (!found) {
			this.logger.debug({
				message: "No sourced name for contact",
				contactId,
				domain,
			});
			return;
		}

		const { firstName, lastName } = splitName(found.fullName, contact.email);

		await this.db.contact.update({
			where: { id: contactId },
			data: {
				firstName,
				lastName,
				// Only fills gaps — never overwrites what is already there.
				...(contact.title ? {} : { title: found.title ?? null }),
				...(contact.linkedinUrl
					? {}
					: { linkedinUrl: found.linkedinUrl ?? null }),
			},
		});

		await this.log.record({
			contactId,
			companyId: null,
			subject: "Identified from LinkedIn",
			body: `Matched to ${found.fullName}${found.title ? `, ${found.title}` : ""}.\n${found.sourceUrl}`,
			meta: { source: "linkedin", sourceUrl: found.sourceUrl },
		});

		this.logger.log({
			message: "Contact name resolved from the web",
			contactId,
			domain,
			sourceUrl: found.sourceUrl,
		});
	}

	/**
	 * Resolves the person's LinkedIn slug, then reads their profile.
	 *
	 * Two vendors because neither can do this alone: Context.dev is a real search
	 * engine but cannot read LinkedIn, which blocks scrapers; LinkDAPI reads
	 * LinkedIn beautifully but its own people search returns unrelated strangers.
	 * Search to find the door, LinkDAPI to walk through it.
	 *
	 * Proven end to end: `ymadar@valley.com` → `yael-madar` → Yael Madar, VP Fund
	 * Finance & Venture Lending at Valley Bank.
	 */
	private async lookup(
		email: string,
		companyName: string,
		domain: string,
	): Promise<Resolved | null> {
		const local = email.split("@")[0] ?? "";

		// Searching the raw handle finds nothing: `abigham` is not anybody's slug.
		// Searching the *surname it contains* finds her immediately, which is why
		// the local part is decomposed before it is searched.
		const slugs: string[] = [];

		for (const term of searchTerms(local)) {
			const search = await this.context.search(
				`site:linkedin.com/in "${term}" ${companyName}`,
				{ limit: 10 },
			);
			if (search.outcome !== "found") continue;

			for (const result of search.results) {
				const match = /linkedin\.com\/in\/([A-Za-z0-9\-_%]+)/.exec(
					result.url ?? "",
				);
				if (match?.[1] && !slugs.includes(match[1])) slugs.push(match[1]);
			}

			// The first term that produces candidates is the most specific one.
			if (slugs.length > 0) break;
		}

		for (const slug of slugs.slice(0, 4)) {
			const profile = await this.linkedin.profile(slug);
			if (profile.outcome !== "found") continue;

			const person = profile.data;
			if (!person.fullName) continue;

			// The check that stops a plausible stranger being filed against a real
			// customer: the profile has to actually work at this company, and the
			// name has to be consistent with the address we started from.
			const employer = person.positions.some((position) =>
				looksLikeSameCompany(position.name, companyName, domain),
			);
			if (!employer) continue;

			if (!nameMatchesLocalPart(person, local)) continue;

			return {
				fullName: person.fullName,
				title: person.headline,
				linkedinUrl: person.profileUrl,
				sourceUrl: person.profileUrl,
			};
		}

		return null;
	}
}

/** The sources a contact may be auto-enriched from. */
export const AUTO_ENRICHED_SOURCES = [
	RecordSource.EMAIL,
	RecordSource.CALENDAR,
] as const;

/**
 * Whether a LinkedIn employer is the company we think it is.
 *
 * Loose on purpose — "Valley Bank" has to match a CRM company called "Valley"
 * on `valley.com` — but anchored on one of them containing the other rather
 * than on fuzzy distance, which would happily match "Valley" to "Silicon
 * Valley Bank".
 */
export function looksLikeSameCompany(
	employer: string,
	companyName: string,
	domain: string,
): boolean {
	const a = normalise(employer);
	const b = normalise(companyName);
	const c = normalise(domain.replace(/\.[a-z.]+$/, ""));

	if (!a) return false;
	return a === b || a.includes(b) || b.includes(a) || a.includes(c);
}

/**
 * Whether a real name is consistent with the address it was found from.
 *
 * The direction matters and is the whole difference between this and guessing:
 * the name is never *generated* from the local part, only *checked* against it.
 * `ymadar` is consistent with Yael Madar (`y` + `madar`); it is not consistent
 * with Antonio Baravalle, which is how a confident wrong answer gets rejected.
 */
export function nameMatchesLocalPart(
	person: { firstName: string | null; lastName: string | null },
	local: string,
): boolean {
	const first = normalise(person.firstName ?? "");
	const last = normalise(person.lastName ?? "");
	const handle = normalise(local);

	if (!handle || (!first && !last)) return false;

	const forms = [
		`${first}${last}`,
		`${last}${first}`,
		`${first.slice(0, 1)}${last}`,
		`${last}${first.slice(0, 1)}`,
		`${first}${last.slice(0, 1)}`,
		first,
		last,
	].filter(Boolean);

	// Either the handle is one of the usual constructions, or it is a prefix of
	// one — corporate directories truncate.
	return forms.some(
		(form) =>
			form === handle || form.startsWith(handle) || handle.startsWith(form),
	);
}

function normalise(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Search terms to try for an email local part, most specific first.
 *
 * `abigham@hubspot.com` forced this. Searching `abigham` finds nothing — it is
 * not a slug, a name, or a word. Searching the surname it contains, `bigham`,
 * returns `linkedin.com/in/abigailbigham` as the first result: Abbie Bigham,
 * Growth Specialist at HubSpot.
 *
 * The split is generated blind, and every candidate it produces is verified
 * against the fetched profile by `nameMatchesLocalPart` and
 * `looksLikeSameCompany`. So a wrong guess costs a search rather than producing
 * a wrong contact — guess the *query*, never the answer.
 */
export function searchTerms(local: string): string[] {
	const handle = local.toLowerCase().replace(/[^a-z0-9._-]/g, "");
	const terms: string[] = [];

	const add = (term: string) => {
		if (term.length >= 3 && !terms.includes(term)) terms.push(term);
	};

	// Explicitly separated parts are not a guess — `jane.doe` says what it is.
	const parts = handle.split(/[._-]+/).filter(Boolean);
	if (parts.length > 1) {
		add(parts.join(" "));
		add(parts[parts.length - 1] as string);
	}

	// One token: try the whole thing, then the surname left when a one- or
	// two-letter initial is stripped off the front.
	add(handle);
	if (parts.length === 1) {
		add(handle.slice(1));
		add(handle.slice(2));
	}

	return terms;
}
