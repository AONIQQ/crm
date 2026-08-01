import { auth, hasSyncScopes, type Session } from "@crm/auth";
import { db } from "@crm/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

export const getSession = cache(
	async (): Promise<Session | null> =>
		auth.api.getSession({ headers: await headers() }),
);

export async function requireSession(): Promise<Session> {
	const session = await getSession();

	if (!session) {
		redirect("/sign-in");
	}

	return session;
}

/**
 * The scopes Google has actually granted this user.
 *
 * `cache()`d, so the gate below costs one query per request no matter how many
 * layouts and pages ask.
 */
const grantedScope = cache(async (userId: string): Promise<string | null> => {
	const account = await db.account.findFirst({
		where: { userId, providerId: "google" },
		select: { scope: true },
	});

	return account?.scope ?? null;
});

/**
 * A session that has granted Gmail and Calendar.
 *
 * Requesting the scopes at sign-in is not the same as having them: Google's
 * granular consent lets someone untick one and complete sign-in anyway, and an
 * account created before those scopes were required still carries the old
 * grant. Either way the CRM would look signed-in and quietly sync nothing, so
 * this is the check that makes mailbox access a real condition of using the
 * tool rather than an intention.
 *
 * Sends them to `/grant-access`, which is outside the app shell — gating inside
 * it would redirect the page that does the gating.
 */
export async function requireGoogleAccess(): Promise<Session> {
	const session = await requireSession();

	if (!hasSyncScopes(await grantedScope(session.user.id))) {
		redirect("/grant-access");
	}

	return session;
}
