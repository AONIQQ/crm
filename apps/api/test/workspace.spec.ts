import { describe, expect, it } from "bun:test";
import { isWorkspaceEmail } from "@crm/auth/workspace";
import { externalParticipants } from "../src/google/participants";

describe("isWorkspaceEmail", () => {
	it("admits our people", () => {
		for (const email of [
			"lewis@trycomp.ai",
			"LEWIS@TryComp.ai",
			"  lewis@trycomp.ai  ",
			"someone@mail.trycomp.ai",
		]) {
			expect(isWorkspaceEmail(email)).toBe(true);
		}
	});

	it("refuses everybody else", () => {
		for (const email of [
			"lewis@gmail.com",
			"lewis@hubspot.com",
			"",
			null,
			undefined,
		]) {
			expect(isWorkspaceEmail(email)).toBe(false);
		}
	});

	it("is not fooled by a lookalike domain", () => {
		// The boundary is a dot, not a substring — otherwise anyone could
		// register trycomp.ai.evil.com and walk into an internal CRM.
		for (const email of [
			"a@trycomp.ai.evil.com",
			"a@nottrycomp.ai",
			"a@trycomp.aid",
			"a@evil.com?@trycomp.ai".replace("?", ""),
		]) {
			expect(isWorkspaceEmail(email)).toBe(false);
		}
	});
});

describe("internal addresses never become leads", () => {
	// Empty sets: proves the workspace domain is excluded on its own, not
	// because a colleague happens to be a CRM user yet.
	const options = {
		ourDomains: new Set(["trycomp.ai"]),
		ourAddresses: new Set<string>(),
		suppressedDomains: new Set<string>(),
	};

	it("drops colleagues even when they are not users", () => {
		const result = externalParticipants(
			[
				{ email: "lewis@trycomp.ai", name: "Lewis" },
				{ email: "newstarter@trycomp.ai", name: "New Starter" },
				{ email: "jane@acme.com", name: "Jane" },
			],
			options,
		);

		expect(result.map((person) => person.email)).toEqual(["jane@acme.com"]);
	});

	it("stores nothing for a wholly internal thread", () => {
		// No external side means the sync drops the thread entirely — an internal
		// conversation is never written to the CRM.
		expect(
			externalParticipants(
				[
					{ email: "lewis@trycomp.ai", name: null },
					{ email: "colleague@trycomp.ai", name: null },
				],
				options,
			),
		).toEqual([]);
	});
});
