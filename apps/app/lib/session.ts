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

const grantedScope = cache(async (userId: string): Promise<string | null> => {
	const account = await db.account.findFirst({
		where: { userId, providerId: "google" },
		select: { scope: true },
	});

	return account?.scope ?? null;
});

export async function requireGoogleAccess(): Promise<Session> {
	const session = await requireSession();

	if (!hasSyncScopes(await grantedScope(session.user.id))) {
		redirect("/grant-access");
	}

	return session;
}
