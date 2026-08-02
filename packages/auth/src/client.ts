import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
	baseURL: process.env.NEXT_PUBLIC_API_URL,
});

export const { getSession, signIn, signOut, useSession } = authClient;

export type AuthClient = typeof authClient;
