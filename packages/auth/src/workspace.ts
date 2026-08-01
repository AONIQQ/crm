import "@crm/env/load";

/**
 * Who is allowed in, and who counts as "us".
 *
 * One list, used by two things that must never disagree: the sign-in guard, and
 * the sync's decision about which side of a conversation is external. If they
 * drifted, a colleague's address would either be refused at the door or filed
 * as a sales lead.
 *
 * This is the whole authorisation model. There are no roles, no organizations
 * and no invitations — "your address is on this list and Google says it is
 * really you" is the entire check, which is why it is a required value rather
 * than one with a friendly default. A CRM that let any Google account in would
 * hand your pipeline to the internet, and an empty list here fails closed:
 * nobody signs in until it is set.
 *
 * `ALLOWED_SIGN_IN` takes a comma-separated mix of the two things people
 * actually have:
 *
 * ```
 * ALLOWED_SIGN_IN="acme.com"                       # everyone at a workspace
 * ALLOWED_SIGN_IN="acme.com,contractor@gmail.com"  # …plus one outsider
 * ALLOWED_SIGN_IN="you@gmail.com"                  # a one-person install
 * ```
 *
 * The third case is why bare addresses are supported at all: a solo self-hoster
 * on a consumer mailbox has no domain to name, and `gmail.com` would be an
 * open door.
 */

type AllowList = {
	/** Whole domains, subdomains included. */
	domains: readonly string[];
	/** Individual addresses, for installs with no workspace domain. */
	addresses: readonly string[];
};

const EMPTY: AllowList = { domains: [], addresses: [] };

/**
 * Parsed on demand rather than at import.
 *
 * This module is imported by `auth.ts`, which the Better Auth CLI loads in a
 * process that has no `.env` at all, and by tests that need to set the list
 * themselves. Reading the variable when it is asked for — memoised on the raw
 * string, so repeated calls cost one comparison — means neither of those has to
 * care about import order.
 */
let cachedSource: string | undefined;
let cached: AllowList = EMPTY;

function allowList(): AllowList {
	const source = process.env.ALLOWED_SIGN_IN ?? "";
	if (source === cachedSource) return cached;

	const domains: string[] = [];
	const addresses: string[] = [];

	for (const raw of source.split(",")) {
		const entry = raw.trim().toLowerCase().replace(/^@/, "");
		if (!entry) continue;
		(entry.includes("@") ? addresses : domains).push(entry);
	}

	cachedSource = source;
	cached = { domains, addresses };
	return cached;
}

/** Domains whose Google accounts may sign in. */
export function workspaceDomains(): readonly string[] {
	return allowList().domains;
}

/**
 * The one Google shows in its account chooser.
 *
 * `undefined` when the allow-list is only bare addresses — `hd` has to be a
 * domain, and sending a garbage one hides every account in the chooser.
 */
export function primaryWorkspaceDomain(): string | undefined {
	return allowList().domains[0];
}

/** Whether anyone at all can sign in. False means `ALLOWED_SIGN_IN` is unset. */
export function hasSignInAllowList(): boolean {
	const { domains, addresses } = allowList();
	return domains.length > 0 || addresses.length > 0;
}

/**
 * Whether an address belongs to us.
 *
 * Subdomain-aware, so `lewis@mail.acme.com` counts against `acme.com`, but a
 * lookalike like `acme.com.evil.com` does not — the boundary is a dot, not a
 * substring.
 */
export function isWorkspaceEmail(email: string | null | undefined): boolean {
	const value = email?.trim().toLowerCase();
	if (!value) return false;

	// Exactly one `@`. Reading the *last* one would let `a@evil.com@acme.com`
	// look like it belongs to us. Google never issues an address like that, but
	// a door should not depend on the other side being well behaved.
	const parts = value.split("@");
	if (parts.length !== 2) return false;

	const [local, host] = parts;
	if (!local || !host) return false;

	const { domains, addresses } = allowList();

	if (addresses.includes(value)) return true;

	return domains.some(
		(domain) => host === domain || host.endsWith(`.${domain}`),
	);
}
