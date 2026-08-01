import { domainFromEmail } from "../companies/domain";

/** One address off a header or an attendee list. */
export type Participant = {
	email: string;
	name: string | null;
};

/**
 * Local parts that never belong to a person worth putting in a CRM.
 *
 * Matched as whole local parts or prefixes: `noreply@` and `no-reply-1234@`
 * are both machines, but `robert@` must not be caught by `bot`.
 */
const AUTOMATED_LOCAL_PARTS = [
	"noreply",
	"no-reply",
	"donotreply",
	"do-not-reply",
	"notifications",
	"notification",
	"mailer-daemon",
	"postmaster",
	"bounce",
	"bounces",
	"auto-confirm",
	"automated",
	// Scheduling tools send the invite from their own address and put the
	// organiser's name in the display name, so without these you get a contact
	// called "Grand Ventures" whose email is calendar-invite@lu.ma.
	"calendar-invite",
	"calendar",
	"invite",
	"invites",
	"invitations",
	"meetings",
	"scheduling",
	"booking",
	"bookings",
	"reply",
	"support",
	"help",
	"hello",
	"info",
	"contact",
	"sales",
	"billing",
	"accounts",
	"team",
];

/**
 * Parses one address out of a mail header.
 *
 * Handles the three shapes Gmail actually returns: `a@b.com`,
 * `Name <a@b.com>`, and `"Last, First" <a@b.com>`. Anything else yields null
 * rather than a half-parsed address, because a junk `fromEmail` is worse than a
 * dropped one — it becomes a contact.
 */
export function parseAddress(input: string): Participant | null {
	const trimmed = input.trim();
	if (!trimmed) return null;

	const angled = trimmed.match(/^(.*)<([^<>]+)>\s*$/);

	const rawEmail = (angled?.[2] ?? trimmed).trim().toLowerCase();
	if (!isEmailish(rawEmail)) return null;

	const rawName = angled?.[1]?.trim() ?? "";
	// Display names arrive quoted more often than not, and the quotes are not
	// part of anybody's name.
	const name = rawName.replace(/^"(.*)"$/, "$1").trim();

	return { email: rawEmail, name: name || null };
}

/** Splits a header that may carry several comma-separated addresses. */
export function parseAddressList(
	header: string | null | undefined,
): Participant[] {
	if (!header) return [];

	const parts: string[] = [];
	let current = "";
	let inQuotes = false;
	let inAngles = false;

	// Not a plain `split(",")`: `"Last, First" <a@b.com>` contains a comma that
	// is not a separator, and splitting on it produces two broken addresses.
	for (const char of header) {
		if (char === '"') inQuotes = !inQuotes;
		if (char === "<") inAngles = true;
		if (char === ">") inAngles = false;

		if (char === "," && !inQuotes && !inAngles) {
			parts.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	parts.push(current);

	const seen = new Set<string>();
	const participants: Participant[] = [];

	for (const part of parts) {
		const parsed = parseAddress(part);
		if (!parsed || seen.has(parsed.email)) continue;
		seen.add(parsed.email);
		participants.push(parsed);
	}

	return participants;
}

/** Whether an address is a machine rather than a person. */
export function isAutomatedAddress(email: string): boolean {
	const local = email.split("@")[0]?.toLowerCase() ?? "";
	if (!local) return true;

	return AUTOMATED_LOCAL_PARTS.some(
		(pattern) =>
			local === pattern ||
			local.startsWith(`${pattern}-`) ||
			local.startsWith(`${pattern}+`) ||
			local.startsWith(`${pattern}_`),
	);
}

/**
 * Whether a name looks like it was derived from the address rather than given.
 *
 * `splitName` is deterministic, so a stored name that matches exactly what it
 * would produce from the email alone is a placeholder nobody has improved on.
 * That is the licence to overwrite it when a real display name turns up — and
 * the guarantee that a name a human typed is never touched.
 */
export function isDerivedName(
	email: string,
	firstName: string,
	lastName: string | null,
): boolean {
	const derived = splitName(null, email);
	return (
		derived.firstName === firstName && (derived.lastName ?? null) === lastName
	);
}

/** A bare, lowercased hostname, or null for a free host or a malformed address. */
export function workDomain(email: string): string | null {
	return domainFromEmail(email);
}

export type ExternalFilterOptions = {
	/**
	 * Our own domains — everyone on one is "us", not a lead.
	 *
	 * A set rather than a single domain: derived from the `User` table, so a team
	 * spread across two domains is handled without configuration.
	 */
	ourDomains: ReadonlySet<string>;
	/** Every address that belongs to a CRM user, for multi-domain teams. */
	ourAddresses: ReadonlySet<string>;
	/** Domains a human has marked "not a customer". */
	suppressedDomains: ReadonlySet<string>;
};

/**
 * The external side of a conversation.
 *
 * Drops our own people, machines, free hosts and suppressed domains, in that
 * order. What survives is the set of addresses that could plausibly identify a
 * company we sell to.
 */
export function externalParticipants(
	participants: readonly Participant[],
	options: ExternalFilterOptions,
): Participant[] {
	return participants.filter((participant) => {
		if (options.ourAddresses.has(participant.email)) return false;

		const domain = workDomain(participant.email);
		// `workDomain` already returns null for gmail.com and friends, which is
		// what keeps a lead's personal address from becoming a "Gmail" company.
		if (!domain) return false;
		if (options.ourDomains.has(domain)) return false;
		if (options.suppressedDomains.has(domain)) return false;
		if (isAutomatedAddress(participant.email)) return false;

		return true;
	});
}

/**
 * The domain a thread or an event is really about.
 *
 * A customer call often has their lawyer or their auditor on it, so the most
 * represented domain wins. `preferKnown` lets the caller break ties with
 * "whichever of these we already have a company for", which is almost always
 * the right answer and is why it is passed in rather than guessed here.
 */
export function dominantDomain(
	participants: readonly Participant[],
	preferKnown: ReadonlySet<string> = new Set(),
): string | null {
	const counts = new Map<string, number>();

	for (const participant of participants) {
		const domain = workDomain(participant.email);
		if (!domain) continue;
		counts.set(domain, (counts.get(domain) ?? 0) + 1);
	}

	if (counts.size === 0) return null;

	let best: string | null = null;
	let bestScore = -1;

	for (const [domain, count] of counts) {
		// A known company outranks a stranger with the same headcount on the
		// thread; otherwise a single cc'd lawyer could steal the match.
		const score = count * 2 + (preferKnown.has(domain) ? 1 : 0);
		if (score > bestScore) {
			best = domain;
			bestScore = score;
		}
	}

	return best;
}

/**
 * Splits a display name into first and last.
 *
 * Everything after the first token is the surname, which is wrong for a
 * minority of names and right for the overwhelming majority — and a contact
 * whose surname reads "van der Berg" is fixable in one edit, whereas no name at
 * all is a row nobody recognises.
 */
export function splitName(
	name: string | null,
	email: string,
): { firstName: string; lastName: string | null } {
	const cleaned = name?.trim().replace(/\s+/g, " ") ?? "";

	if (cleaned && !cleaned.includes("@")) {
		// "Last, First" is how a lot of corporate directories render it.
		const comma = cleaned.match(/^([^,]+),\s*(.+)$/);
		if (comma?.[1] && comma[2]) {
			return { firstName: comma[2].trim(), lastName: comma[1].trim() };
		}

		const [first, ...rest] = cleaned.split(" ");
		if (first) {
			return {
				firstName: first,
				lastName: rest.length > 0 ? rest.join(" ") : null,
			};
		}
	}

	// No usable display name: the local part is the least-bad label, tidied so
	// "jane.doe" reads as "Jane Doe" rather than as a slug.
	const local = email.split("@")[0] ?? email;
	const words = local
		.split(/[._-]+/)
		.filter(Boolean)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1));

	if (words.length === 0) return { firstName: email, lastName: null };

	return {
		firstName: words[0] as string,
		lastName: words.length > 1 ? words.slice(1).join(" ") : null,
	};
}

function isEmailish(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
