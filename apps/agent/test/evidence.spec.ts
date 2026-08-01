import { describe, expect, it } from "bun:test";
import {
	BAND_FLOOR,
	bandFor,
	type Evidence,
	scoreEvidence,
} from "../agent/lib/evidence";

const of = (...kinds: Evidence["kind"][]): Evidence[] =>
	kinds.map((kind) => ({ kind, detail: `saw ${kind}` }));

describe("scoreEvidence", () => {
	it("writes a fact when a primary source names them", () => {
		// Their own profile carrying their email address is as good as it gets.
		const scored = scoreEvidence(of("profile.email-match"));
		expect(scored.band).toBe("VERIFIED");
		expect(scored.hasPrimary).toBe(true);
	});

	it("treats our own mailbox as primary evidence", () => {
		// The §1 argument in one assertion: a reply on a thread we synced is
		// worth more than anything a data vendor can sell us, and it carries a
		// fact on its own.
		expect(scoreEvidence(of("crm.thread-reply")).band).toBe("VERIFIED");
	});

	it("writes a title a signature block states on a thread they replied to", () => {
		// The realistic shape of a title read out of our own mailbox: the reply
		// proves it is them, the signature states the role. Either alone is a
		// suggestion; together they are a fact.
		expect(scoreEvidence(of("crm.signature-block")).band).toBe("PROBABLE");
		expect(
			scoreEvidence(of("crm.thread-reply", "crm.signature-block")).band,
		).toBe("VERIFIED");
	});

	it("refuses to write anything without a primary source, however much of it there is", () => {
		const scored = scoreEvidence(
			of(
				"handle.name-form",
				"search.cites-profile",
				"web.cited-claim",
				"employer-only",
			),
		);

		// Four weak signals pile up to a confident-looking number and are still
		// not allowed to write. This is the rule that stops a plausible stranger
		// becoming a customer record.
		expect(scored.score).toBeGreaterThan(BAND_FLOOR.PROBABLE);
		expect(scored.hasPrimary).toBe(false);
		expect(scored.band).toBe("PROBABLE");
	});

	it("holds the primary-source rule even if the weights are re-calibrated upwards", () => {
		// The invariant, independent of the numbers in the table: a score alone
		// never licenses a write.
		expect(bandFor(0.99, false)).toBe("PROBABLE");
		expect(bandFor(0.85, true)).toBe("VERIFIED");
	});

	it("makes an unreadable X handle a suggestion, not a value", () => {
		// Exactly what verifyX produces. X cannot be read, so the best available
		// is two indirect signals agreeing — which is a question for a human.
		const scored = scoreEvidence(
			of("handle.name-form", "search.cites-profile"),
		);
		expect(scored.band).toBe("PROBABLE");
	});

	it("holds a fact when sources disagree, rather than averaging them", () => {
		const scored = scoreEvidence([
			...of("linkedin.employer-and-name"),
			{
				kind: "contradiction",
				detail: "their signature says a different employer",
			},
		]);

		expect(scored.band).toBe("POSSIBLE");
		expect(scored.rationale).toContain("Held:");
	});

	it("drops evidence too weak to keep at all", () => {
		expect(scoreEvidence(of("employer-only")).band).toBeNull();
		expect(scoreEvidence([]).band).toBeNull();
	});

	it("never claims certainty", () => {
		const everything = scoreEvidence(
			of(
				"profile.email-match",
				"linkedin.employer-and-name",
				"crm.thread-reply",
				"github.account-identity",
			),
		);
		expect(everything.score).toBeLessThan(1);
	});

	it("explains itself in words a rep could read", () => {
		const scored = scoreEvidence(
			of("github.account-identity", "handle.name-form"),
		);
		expect(scored.rationale).toContain("GitHub account");
		expect(scored.rationale).toContain("handle");
	});
});
