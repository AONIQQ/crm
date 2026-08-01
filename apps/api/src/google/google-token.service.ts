import { auth } from "@crm/auth";
import { type Db } from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import {
	GOOGLE_PROVIDER_ID,
	SCOPE_FOR_SOURCE,
	type SyncSource,
} from "./google.constants";

/** Why a token could not be produced. Callers branch on this, not on a string. */
export type TokenFailure =
	/** No refresh token, or Google rejected it. The rep has to reconnect. */
	| { outcome: "needs-reconnect"; reason: string }
	/** The grant never included this scope. Not an error — just not connected. */
	| { outcome: "not-connected"; reason: string };

export type TokenResult = { outcome: "ok"; accessToken: string } | TokenFailure;

/**
 * The only place an access token is obtained.
 *
 * Nothing reads `Account.accessToken` directly: Better Auth's `getAccessToken`
 * refreshes an expired token and persists the new one, so a hand-rolled refresh
 * would be a second, worse implementation of the same thing racing the first.
 */
@Injectable()
export class GoogleTokenService {
	private readonly logger = new Logger(GoogleTokenService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	/** The scopes Google has actually granted this user, from the account row. */
	async grantedScopes(userId: string): Promise<string[]> {
		const account = await this.db.account.findFirst({
			where: { userId, providerId: GOOGLE_PROVIDER_ID },
			select: { scope: true },
		});

		return (
			account?.scope
				?.split(",")
				.map((scope) => scope.trim())
				.filter(Boolean) ?? []
		);
	}

	/** Whether the grant covers a source. The grant *is* the connection state. */
	async isConnected(userId: string, source: SyncSource): Promise<boolean> {
		const scopes = await this.grantedScopes(userId);
		return scopes.includes(SCOPE_FOR_SOURCE[source]);
	}

	/**
	 * Whether Google issued a refresh token for this grant.
	 *
	 * Google only returns one when it re-prompts. If a reconnect slipped through
	 * without a prompt there is no refresh token, and everything works until the
	 * access token expires an hour later — so the connect flow checks this
	 * immediately rather than discovering it on the first cron tick.
	 */
	async hasRefreshToken(userId: string): Promise<boolean> {
		const account = await this.db.account.findFirst({
			where: { userId, providerId: GOOGLE_PROVIDER_ID },
			select: { refreshToken: true },
		});

		return Boolean(account?.refreshToken);
	}

	/**
	 * A valid access token for a source, or why there isn't one.
	 *
	 * Returns a result rather than throwing: "this rep never connected Gmail" is
	 * an ordinary state for a cron tick iterating every user, not an exception.
	 */
	async accessTokenFor(
		userId: string,
		source: SyncSource,
	): Promise<TokenResult> {
		if (!(await this.isConnected(userId, source))) {
			return {
				outcome: "not-connected",
				reason: `The ${source} scope has not been granted.`,
			};
		}

		try {
			const { accessToken } = await auth.api.getAccessToken({
				body: { providerId: GOOGLE_PROVIDER_ID, userId },
			});

			if (!accessToken) {
				return {
					outcome: "needs-reconnect",
					reason: "Google returned no access token.",
				};
			}

			return { outcome: "ok", accessToken };
		} catch (error) {
			// A refresh failure means the refresh token is gone — revoked, expired
			// or never issued. Retrying cannot fix it, so this is terminal until
			// the rep reconnects.
			this.logger.warn({
				message: "Google token refresh failed",
				userId,
				source,
				reason: error instanceof Error ? error.message : String(error),
			});

			return {
				outcome: "needs-reconnect",
				reason: "Google would not refresh the access token.",
			};
		}
	}

	/**
	 * Revokes the grant at Google.
	 *
	 * This kills the *whole* grant, sign-in included, because one OAuth client
	 * means one grant per user. It is deliberately not what the disconnect button
	 * calls — see `GoogleConnectionService.disconnect`.
	 */
	async revoke(userId: string): Promise<boolean> {
		const account = await this.db.account.findFirst({
			where: { userId, providerId: GOOGLE_PROVIDER_ID },
			select: { refreshToken: true, accessToken: true },
		});

		const token = account?.refreshToken ?? account?.accessToken;
		if (!token) return false;

		const response = await fetch("https://oauth2.googleapis.com/revoke", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ token }),
		});

		if (!response.ok) {
			this.logger.warn({
				message: "Google token revocation failed",
				userId,
				status: response.status,
			});
			return false;
		}

		// The stored tokens are dead now; clearing them stops every later call
		// from trying to use them and getting a confusing 401.
		await this.db.account.updateMany({
			where: { userId, providerId: GOOGLE_PROVIDER_ID },
			data: {
				accessToken: null,
				refreshToken: null,
				scope: null,
				accessTokenExpiresAt: null,
				refreshTokenExpiresAt: null,
			},
		});

		this.logger.log({ message: "Google access revoked", userId });
		return true;
	}
}
