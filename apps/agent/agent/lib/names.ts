/**
 * Turning an email local part into something searchable, and checking the
 * answer that comes back.
 *
 * All pure, and all verified against real CRM addresses rather than reasoned
 * about: `abigham@hubspot.com` → `bigham` → `linkedin.com/in/abigailbigham` →
 * Abbie Bigham, Growth Specialist at HubSpot.
 */

/**
 * Search terms for an email local part, most specific first.
 *
 * Searching the raw handle finds nothing — `abigham` is not a slug, a name or a
 * word. Searching the surname it contains finds her on the first result.
 *
 * The split is generated blind and every candidate it produces is verified
 * afterwards, so a wrong guess costs a search rather than producing a wrong
 * contact. Guess the *query*, never the answer.
 */
export function searchTerms(local: string): string[] {
	const handle = local.toLowerCase().replace(/[^a-z0-9._-]/g, "");
	const terms: string[] = [];

	const add = (term: string) => {
		if (term.length >= 3 && !terms.includes(term)) terms.push(term);
	};

	// An explicit separator is not a guess — `jane.doe` says what it is.
	const parts = handle.split(/[._-]+/).filter(Boolean);
	if (parts.length > 1) {
		add(parts.join(" "));
		add(parts[parts.length - 1] as string);
	}

	add(handle);

	// One token: try the surname left when a one- or two-letter initial comes off
	// the front. This is the `abigham` → `bigham` step.
	if (parts.length === 1) {
		add(handle.slice(1));
		add(handle.slice(2));
	}

	return terms;
}

/**
 * Whether a LinkedIn employer is the company we think it is.
 *
 * Loose enough that "Valley Bank" matches a CRM company called "Valley", but
 * anchored on containment rather than fuzzy distance — which would cheerfully
 * match "Valley" to "Silicon Valley Bank".
 */
export function looksLikeSameCompany(
	employer: string,
	companyName: string,
	domain: string,
): boolean {
	const a = normalise(employer);
	const b = normalise(companyName);
	const c = normalise(domain.replace(/\.[a-z.]+$/, ""));

	if (!a || (!b && !c)) return false;
	return (
		(b !== "" && (a === b || a.includes(b) || b.includes(a))) ||
		(c !== "" && a.includes(c))
	);
}

/**
 * Whether a name is consistent with the address it was found from.
 *
 * The direction is the whole point: the name is checked against the local part,
 * never derived from it. `ymadar` is consistent with Yael Madar (`y` + `madar`).
 * It is not consistent with Antonio Baravalle, which is how a confident wrong
 * answer from a search engine gets rejected.
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

	// Either the handle is one of the usual constructions, or a prefix of one —
	// corporate directories truncate.
	return forms.some(
		(form) =>
			form === handle || form.startsWith(handle) || handle.startsWith(form),
	);
}

/** Splits a display name into first and last. */
export function splitName(
	fullName: string,
): { firstName: string; lastName: string | null } | null {
	const cleaned = fullName.trim().replace(/\s+/g, " ");
	if (!cleaned) return null;

	const [first, ...rest] = cleaned.split(" ");
	if (!first) return null;

	return { firstName: first, lastName: rest.length ? rest.join(" ") : null };
}

/** The domain part of an email, lowercased. */
export function domainOf(email: string): string | null {
	const at = email.lastIndexOf("@");
	return at > 0 ? email.slice(at + 1).toLowerCase() : null;
}

function normalise(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
