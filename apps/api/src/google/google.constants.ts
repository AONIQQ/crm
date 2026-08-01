import { CALENDAR_SCOPE, GMAIL_SCOPE } from "@crm/auth";

/**
 * The scope strings come from `@crm/auth`, which is where the OAuth request is
 * actually made. Re-declaring them here would be two lists that drift, and the
 * failure is silent: the grant looks right and `isConnected()` says no.
 */
export { CALENDAR_SCOPE, GMAIL_SCOPE, SYNC_SCOPES } from "@crm/auth";

/**
 * The two sources sync independently: they have separate cursors, separate
 * failure modes and separate auto-create rules, so they get separate
 * `MailboxSync` rows rather than one row with two of everything.
 */
export const SYNC_SOURCES = ["calendar", "gmail"] as const;
export type SyncSource = (typeof SYNC_SOURCES)[number];

/** Which scope has to be granted for a source to be syncable. */
export const SCOPE_FOR_SOURCE: Record<SyncSource, string> = {
	calendar: CALENDAR_SCOPE,
	gmail: GMAIL_SCOPE,
};

/** Better Auth's provider id. One provider, one grant — see the plan §3.4. */
export const GOOGLE_PROVIDER_ID = "google";
