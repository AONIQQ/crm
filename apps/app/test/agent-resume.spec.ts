import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { recordCopy, recordFilter, recordHeader } from "../lib/agent-record";
import { parseResumeTail } from "../lib/agent-resume";

/**
 * Picking a conversation back up.
 *
 * The bug these exist for: sending into a resumed thread did nothing at all.
 * eve only accepts input on a *waiting* session, and the token we had stored
 * was from before the last turn ended — so the send was rejected in silence.
 */

const NOW = Date.parse("2026-08-01T12:00:00.000Z");

const line = (
	type: string,
	data: unknown = {},
	at: string = "2026-08-01T12:00:00.000Z",
) => JSON.stringify({ type, data, meta: { id: `evt_${type}`, at } });

describe("parseResumeTail", () => {
	it("recovers the current token from a waiting session", () => {
		const state = parseResumeTail(
			line("session.waiting", { continuationToken: "eve:fresh" }),
			NOW,
		);

		expect(state).toEqual({
			status: "waiting",
			continuationToken: "eve:fresh",
		});
	});

	it("reads a mid-turn session as busy rather than ready", () => {
		// This is the exact case that swallowed a message: the turn was still
		// running, so nothing could be accepted.
		expect(parseResumeTail(line("actions.requested"), NOW)).toEqual({
			status: "busy",
		});
		expect(parseResumeTail(line("reasoning.appended"), NOW)).toEqual({
			status: "busy",
		});
	});

	it("retires a turn that stopped mid-sentence instead of locking on it", () => {
		// A restarted agent leaves sessions with no closing boundary. They never
		// reach `session.waiting`, so without this they read as busy forever and
		// the composer can never be used on that thread again.
		const abandoned = line(
			"reasoning.appended",
			{},
			"2026-08-01T11:50:00.000Z",
		);

		expect(parseResumeTail(abandoned, NOW)).toEqual({ status: "finished" });
	});

	it("does not retire a turn that is merely between events", () => {
		const recent = line("step.started", {}, "2026-08-01T11:59:30.000Z");

		expect(parseResumeTail(recent, NOW)).toEqual({ status: "busy" });
	});

	it("never retires a live session for want of a timestamp", () => {
		const noMeta = JSON.stringify({ type: "actions.requested", data: {} });

		expect(parseResumeTail(noMeta, NOW)).toEqual({ status: "busy" });
	});

	it("knows a finished session cannot be continued", () => {
		// eve resets local state on these, and the next send starts fresh.
		expect(parseResumeTail(line("session.completed"), NOW)).toEqual({
			status: "finished",
		});
		expect(parseResumeTail(line("session.failed"), NOW)).toEqual({
			status: "finished",
		});
	});

	it("takes the last event when the tail returns several", () => {
		const state = parseResumeTail(
			[
				line("step.completed"),
				line("turn.completed"),
				line("session.waiting", { continuationToken: "eve:last" }),
			].join("\n"),
			NOW,
		);

		expect(state).toEqual({ status: "waiting", continuationToken: "eve:last" });
	});

	it("survives a half-written line, which a tail read can produce", () => {
		const state = parseResumeTail(
			`${line("session.waiting", { continuationToken: "eve:whole" })}\n{"type":"acti`,
			NOW,
		);

		expect(state).toEqual({
			status: "waiting",
			continuationToken: "eve:whole",
		});
	});

	it("treats an empty or unreadable tail as busy, never as ready", () => {
		// Failing closed: a wrong "ready" sends a message into a void, a wrong
		// "busy" only asks somebody to try again.
		expect(parseResumeTail("", NOW)).toEqual({ status: "busy" });
		expect(parseResumeTail("not json at all", NOW)).toEqual({ status: "busy" });
	});

	it("does not invent a token a waiting session did not carry", () => {
		expect(parseResumeTail(line("session.waiting"), NOW)).toEqual({
			status: "waiting",
			continuationToken: undefined,
		});
	});
});

describe("record context", () => {
	it("asks about the thing you are actually looking at", () => {
		expect(recordCopy("contact").title).toBe("Ask about this person");
		expect(recordCopy("company").title).toBe("Ask about this company");
		expect(recordCopy("deal").title).toBe("Ask about this deal");
	});

	it("offers questions that suit the record", () => {
		// The tell of a bolted-on chat box is "Who is this person?" on a company.
		expect(recordCopy("company").suggestions.join(" ")).not.toContain("person");
		expect(recordCopy("deal").suggestions.join(" ")).not.toContain("person");
		expect(recordCopy("contact").suggestions[0]).toBe("Who is this person?");
	});

	it("tells the agent which record it is on", () => {
		expect(recordHeader({ kind: "contact", id: "c1" })).toEqual({
			"x-crm-contact": "c1",
		});
		expect(recordHeader({ kind: "company", id: "co1" })).toEqual({
			"x-crm-company": "co1",
		});
		expect(recordHeader({ kind: "deal", id: "d1" })).toEqual({
			"x-crm-deal": "d1",
		});
	});

	it("files a conversation under one record and no other", () => {
		expect(recordFilter({ kind: "deal", id: "d1" })).toEqual({ dealId: "d1" });
		expect(Object.keys(recordFilter({ kind: "company", id: "co1" }))).toEqual([
			"companyId",
		]);
	});
});

describe("the panel's copy", () => {
	/**
	 * A source-level check, deliberately.
	 *
	 * This bug shipped twice: the suggestions were wired to the record while the
	 * heading above them stayed a literal, so a deal offered "Where does this
	 * stand?" under "Ask about this person". There is no DOM here to render
	 * against, and the defect is precisely "a string that should have come from
	 * `recordCopy` did not" — which is visible in the file.
	 */
	it("comes from the record, never from a literal in the component", () => {
		const source = readFileSync(
			new URL("../components/crm/agent-panel.tsx", import.meta.url),
			"utf8",
		);

		// Anything user-facing and record-specific belongs in `agent-record.ts`.
		for (const kind of ["contact", "company", "deal"] as const) {
			const copy = recordCopy(kind);
			for (const literal of [copy.title, copy.blurb, copy.placeholder]) {
				expect(source).not.toContain(literal);
			}
		}
	});
});
