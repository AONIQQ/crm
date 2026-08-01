/**
 * Who is allowed in, and who counts as "us".
 *
 * One list, used by two things that must never disagree: the sign-in guard, and
 * the sync's decision about which side of a conversation is external. If they
 * drifted, a colleague's address would either be refused at the door or filed
 * as a sales lead.
 */

/** Domains whose Google accounts may sign in. */
export const WORKSPACE_DOMAINS = ["trycomp.ai"] as const;

/** The one Google shows in its account chooser. */
export const PRIMARY_WORKSPACE_DOMAIN = WORKSPACE_DOMAINS[0];

/**
 * Whether an address belongs to us.
 *
 * Subdomain-aware, so `lewis@mail.trycomp.ai` counts, but a lookalike like
 * `trycomp.ai.evil.com` does not — the boundary is a dot, not a substring.
 */
export function isWorkspaceEmail(email: string | null | undefined): boolean {
	const value = email?.trim().toLowerCase();
	if (!value) return false;

	// Exactly one `@`. Reading the *last* one would let `a@evil.com@trycomp.ai`
	// look like it belongs to us. Google never issues an address like that, but
	// a door should not depend on the other side being well behaved.
	const parts = value.split("@");
	if (parts.length !== 2) return false;

	const [local, host] = parts;
	if (!local || !host) return false;

	return WORKSPACE_DOMAINS.some(
		(domain) => host === domain || host.endsWith(`.${domain}`),
	);
}
