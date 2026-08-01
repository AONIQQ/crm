import {
	type AuthFn,
	extractBearerToken,
	localDev,
	vercelOidc,
	verifyJwtHmac,
	withAuthChallenges,
} from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

/**
 * The HTTP surface, and who is allowed to reach it.
 *
 * Three callers, in the order they are tried:
 *
 * 1. **A rep, through the CRM** — see `repFromCrm` below.
 * 2. **Vercel-to-Vercel**, for callers inside the deployment boundary.
 * 3. **localhost**, for `eve dev` and the terminal UI.
 *
 * Auth fails closed. With `AGENT_BRIDGE_SECRET` unset, entry 1 is skipped
 * rather than opened: no shared signer, no way for the proxy to prove who it
 * is, so the panel stops working and nothing else changes.
 */

/** Both halves must agree on these, so they are stated once and exported. */
export const BRIDGE_ISSUER = "crm-app";
export const BRIDGE_AUDIENCE = "crm-agent";

/**
 * A signed-in rep, arriving through the CRM's proxy.
 *
 * The browser never talks to this agent directly. `apps/app` proxies
 * `/eve/v1/*` on its own origin, checks the Better Auth session, and mints a
 * two-minute HS256 token naming the person. That avoids CORS, avoids scoping a
 * session cookie to a third host, and — the part that matters — tells the agent
 * *which rep* is asking rather than merely that the app is.
 *
 * Wrapping `verifyJwtHmac` rather than using the `jwtHmac()` helper directly,
 * for one reason worth stating: the helper maps an HMAC token to
 * `principalType: "service"` with `principalId: "crm-app:<sub>"`, which is the
 * right default for a shared machine credential and wrong here. This is a
 * person. `lib/approval.ts` decides whether to pause for a human by reading
 * exactly these fields, so getting them right is the difference between a rep
 * being asked to confirm a job change and the agent quietly refusing.
 */
export function repFromCrm(secret: string): AuthFn<Request> {
	return withAuthChallenges(
		async (request: Request) => {
			const result = await verifyJwtHmac(
				extractBearerToken(request.headers.get("authorization")),
				{
					algorithm: "HS256",
					audiences: [BRIDGE_AUDIENCE],
					issuer: BRIDGE_ISSUER,
					secret,
				},
			);

			if (!result.ok) return null;

			const claims = result.sessionAuth;
			const userId = claims.subject;
			if (!userId) return null;

			return {
				attributes: claims.attributes ?? {},
				authenticator: "crm-app",
				principalId: userId,
				principalType: "user" as const,
			};
		},
		[{ scheme: "Bearer" }],
	);
}

const secret = process.env.AGENT_BRIDGE_SECRET;

export default eveChannel({
	auth: [...(secret ? [repFromCrm(secret)] : []), vercelOidc(), localDev()],
});
