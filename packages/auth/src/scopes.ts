/**
 * The Google scopes this CRM runs on.
 *
 * Defined here rather than in the API because the OAuth request is made from
 * this package — and because the API, the sign-in page and the settings page all
 * have to agree on the exact strings. Two copies of a scope list drift, and the
 * failure mode is silent: the grant looks fine and `isConnected()` says no.
 */

/** Identity. Always requested; Better Auth's Google provider adds these itself. */
export const IDENTITY_SCOPES = ["openid", "email", "profile"] as const;

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const CALENDAR_SCOPE =
	"https://www.googleapis.com/auth/calendar.readonly";

/**
 * Read-only Gmail and Calendar.
 *
 * Requested at sign-in, not behind a Connect button: this is an internal,
 * single-tenant tool where seeing the conversation on a record is the point, so
 * a rep with a CRM account and no mailbox connected is a half-configured
 * account nobody notices is broken.
 *
 * Read-only is not negotiable in v1 — nothing writes back to Google.
 */
export const SYNC_SCOPES = [GMAIL_SCOPE, CALENDAR_SCOPE] as const;

/** Everything a fully provisioned account has granted. */
export const REQUIRED_SCOPES = [...IDENTITY_SCOPES, ...SYNC_SCOPES] as const;

/**
 * Whether a grant covers the sync scopes.
 *
 * Takes the raw comma-separated `Account.scope` string, because that is the
 * only place the truth lives — Google's granular consent lets someone untick a
 * scope and still complete sign-in, so "they signed in" does not imply "they
 * granted it".
 */
export function hasSyncScopes(scope: string | null | undefined): boolean {
	const granted = parseScopes(scope);
	return SYNC_SCOPES.every((needed) => granted.has(needed));
}

/** `Account.scope` as a set. Google returns it comma- or space-separated. */
export function parseScopes(scope: string | null | undefined): Set<string> {
	return new Set(
		(scope ?? "")
			.split(/[,\s]+/)
			.map((entry) => entry.trim())
			.filter(Boolean),
	);
}
