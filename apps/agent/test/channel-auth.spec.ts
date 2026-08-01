import { describe, expect, it } from "bun:test";
import {
	BRIDGE_AUDIENCE,
	BRIDGE_ISSUER,
	repFromCrm,
} from "../agent/channels/eve";
import { isAutomated } from "../agent/lib/approval";

/**
 * Who the agent thinks is calling.
 *
 * Two things are being protected here. The obvious one is that a forged or
 * expired token cannot reach an agent that can read every email in the CRM.
 * The subtler one is that a *valid* token has to resolve to a **person**:
 * `lib/approval.ts` pauses for a human only when it can tell one is there, and
 * eve's own `jwtHmac()` helper would have labelled this a service principal.
 */

const SECRET = "test-secret-at-least-long-enough-to-be-a-secret";
const auth = repFromCrm(SECRET);

/** Mirrors `apps/app/lib/agent-bridge.ts`; the app-side test proves the pair. */
async function mint(
	claims: Record<string, unknown>,
	secret = SECRET,
): Promise<string> {
	const encode = (value: object) =>
		Buffer.from(JSON.stringify(value)).toString("base64url");

	const signingInput = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}`;
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(signingInput),
	);

	return `${signingInput}.${Buffer.from(signature).toString("base64url")}`;
}

function request(token: string | null): Request {
	return new Request("https://agent.example.com/eve/v1/session", {
		method: "POST",
		headers: token ? { authorization: `Bearer ${token}` } : {},
	});
}

function claims(overrides: Record<string, unknown> = {}) {
	const now = Math.floor(Date.now() / 1000);
	return {
		iss: BRIDGE_ISSUER,
		aud: BRIDGE_AUDIENCE,
		sub: "user_123",
		email: "lewis@trycomp.ai",
		name: "Lewis Carhart",
		iat: now,
		nbf: now - 5,
		exp: now + 120,
		...overrides,
	};
}

describe("repFromCrm", () => {
	it("resolves a valid token to the rep, as a person", async () => {
		const result = await auth(request(await mint(claims())));

		expect(result).toMatchObject({
			authenticator: "crm-app",
			principalId: "user_123",
			principalType: "user",
		});
	});

	it("produces a principal the approval policy reads as human", async () => {
		// The assertion the whole panel rests on: a rep asking is not the cron
		// principal, so a sensitive write prompts them instead of being refused.
		const session = await auth(request(await mint(claims())));

		expect(isAutomated({ auth: { current: session } })).toBe(false);
	});

	it("carries the rep's identity for the agent to attribute work to", async () => {
		const session = await auth(request(await mint(claims())));

		expect(session).toMatchObject({
			attributes: { email: "lewis@trycomp.ai", name: "Lewis Carhart" },
		});
	});

	it("skips a request with no token, rather than accepting it", async () => {
		expect(await auth(request(null))).toBeNull();
	});

	it("skips a token signed with the wrong secret", async () => {
		const forged = await mint(claims(), "not-the-shared-secret");
		expect(await auth(request(forged))).toBeNull();
	});

	it("skips a token whose payload was swapped for another user", async () => {
		// The attack that matters: take your own valid token, rewrite `sub`, keep
		// the signature. Nothing else in the system re-checks who the caller is.
		const token = await mint(claims());
		const [header, , signature] = token.split(".");
		const impersonated = Buffer.from(
			JSON.stringify(claims({ sub: "somebody_else" })),
		).toString("base64url");

		expect(
			await auth(request(`${header}.${impersonated}.${signature}`)),
		).toBeNull();
	});

	it("skips a token whose signature was altered", async () => {
		const token = await mint(claims());
		const [header, payload, signature] = token.split(".");

		// Flipped in the middle, deliberately. The *last* base64url character of
		// a 43-character signature carries only two significant bits — 32 bytes is
		// 256 bits and 43 characters hold 258 — so changing it can decode to the
		// same MAC and pass. A tamper test that only touches the final character
		// is a test that passes for the wrong reason.
		const middle = Math.floor((signature as string).length / 2);
		const swapped = (signature as string)[middle] === "A" ? "B" : "A";
		const altered = `${(signature as string).slice(0, middle)}${swapped}${(
			signature as string
		).slice(middle + 1)}`;

		expect(await auth(request(`${header}.${payload}.${altered}`))).toBeNull();
	});

	it("skips an expired token", async () => {
		const now = Math.floor(Date.now() / 1000);
		const stale = await mint(claims({ iat: now - 600, exp: now - 300 }));
		expect(await auth(request(stale))).toBeNull();
	});

	it("skips a token minted for a different agent", async () => {
		expect(
			await auth(request(await mint(claims({ aud: "someone-else" })))),
		).toBeNull();
	});

	it("skips a token from a different issuer", async () => {
		expect(
			await auth(request(await mint(claims({ iss: "not-our-app" })))),
		).toBeNull();
	});

	it("skips a token that names nobody", async () => {
		expect(
			await auth(request(await mint(claims({ sub: undefined })))),
		).toBeNull();
	});
});
