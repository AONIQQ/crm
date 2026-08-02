import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
	baseURL: typeof window === "undefined" ? undefined : window.location.origin,
});

export const { getSession, signIn, signOut, useSession } = authClient;

export type AuthClient = typeof authClient;
