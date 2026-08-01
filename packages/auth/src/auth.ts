import { db } from "@crm/db";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { env } from "./env";
import { SYNC_SCOPES } from "./scopes";

const socialProviders: NonNullable<BetterAuthOptions["socialProviders"]> = {};

if (env.google) {
	socialProviders.google = {
		...env.google,

		// Gmail and Calendar are asked for at sign-in, not behind a Connect
		// button. This is an internal, single-tenant tool: reading the mailbox is
		// what the CRM is for, so it is a condition of having an account rather
		// than an optional extra.
		//
		// Requesting them here is necessary but not sufficient — Google's granular
		// consent lets someone untick a scope and still finish signing in, so the
		// app also gates on what was actually granted. See
		// `requireGoogleAccess()` in the Next.js app.
		scope: [...SYNC_SCOPES],

		// Offline access, so Google issues a refresh token. Without it the
		// connection dies silently one hour after sign-in, with nothing to
		// refresh from.
		//
		// Deliberately not `prompt: "consent"`: it would show the consent screen
		// on every single sign-in. It is not needed, because a first sign-in — and
		// any sign-in that asks for a scope the user has not yet granted — makes
		// Google prompt anyway, and it is that prompt which mints the refresh
		// token. The missing-refresh-token case is detected and repaired rather
		// than pre-empted.
		accessType: "offline",
	};
}

export const auth = betterAuth({
	appName: "CRM",

	database: prismaAdapter(db, {
		provider: "postgresql",
	}),

	emailAndPassword: {
		enabled: false,
	},

	socialProviders,

	account: {
		accountLinking: {
			enabled: true,
			trustedProviders: ["google"],
		},
	},

	session: {
		expiresIn: 60 * 60 * 24 * 7,
		updateAge: 60 * 60 * 24,
		cookieCache: {
			enabled: true,
			maxAge: 5 * 60,
		},
	},

	rateLimit: {
		enabled: true,
		storage: "database",
	},

	advanced: {
		useSecureCookies: env.isProduction,
		...(env.cookieDomain && {
			crossSubDomainCookies: {
				enabled: true,
				domain: env.cookieDomain,
			},
		}),
	},

	trustedOrigins: [...env.trustedOrigins],
	hooks: {},
	databaseHooks: {},
});

export type Auth = typeof auth;
export type Session = typeof auth.$Infer.Session;
export type SessionUser = Session["user"];
