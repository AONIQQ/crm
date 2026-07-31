const optional = (key: string): string | undefined => {
	const value = process.env[key];
	return value && value.length > 0 ? value : undefined;
};

const googleCredentials = ():
	| { clientId: string; clientSecret: string }
	| undefined => {
	const clientId = optional("GOOGLE_CLIENT_ID");
	const clientSecret = optional("GOOGLE_CLIENT_SECRET");

	if (!clientId || !clientSecret) {
		if (clientId || clientSecret) {
			throw new Error(
				"GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together.",
			);
		}
		return undefined;
	}

	return { clientId, clientSecret };
};

const trustedOrigins = (
	optional("AUTH_TRUSTED_ORIGINS")
		?.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean) ?? []
).concat(optional("BETTER_AUTH_URL") ?? []);

export const env = {
	appUrl: optional("BETTER_AUTH_URL"),
	google: googleCredentials(),
	cookieDomain: optional("AUTH_COOKIE_DOMAIN"),
	trustedOrigins: [...new Set(trustedOrigins)],
	isProduction: process.env.NODE_ENV === "production",
} as const;
