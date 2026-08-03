export const GOOGLE_PROVIDER_ID = "google";

export const IDENTITY_SCOPES = ["openid", "email", "profile"] as const;

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const CALENDAR_SCOPE =
	"https://www.googleapis.com/auth/calendar.readonly";

export const SYNC_SCOPES = [GMAIL_SCOPE, CALENDAR_SCOPE] as const;

export const REQUIRED_SCOPES = [...IDENTITY_SCOPES, ...SYNC_SCOPES] as const;

export function hasSyncScopes(scope: string | null | undefined): boolean {
	const granted = parseScopes(scope);
	return SYNC_SCOPES.every((needed) => granted.has(needed));
}

export type SignInAccount = {
	providerId: string;
	scope?: string | null;
};

export function needsGoogleGrant(accounts: readonly SignInAccount[]): boolean {
	const google = accounts.find(
		(account) => account.providerId === GOOGLE_PROVIDER_ID,
	);

	if (!google) return false;

	const viaSso = accounts.some(
		(account) => account.providerId !== GOOGLE_PROVIDER_ID,
	);

	if (viaSso) return false;

	return !hasSyncScopes(google.scope);
}

export function parseScopes(scope: string | null | undefined): Set<string> {
	return new Set(
		(scope ?? "")
			.split(/[,\s]+/)
			.map((entry) => entry.trim())
			.filter(Boolean),
	);
}
