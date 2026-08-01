import { defineState } from "eve/context";

/**
 * Who and what this session is about, and what it has spent.
 *
 * Durable per-session state rather than an argument threaded through every
 * tool: the audit hook needs the contact id to file an event against a record,
 * and a hook receives the event, not the tool's arguments. Any tool that takes
 * a `contactId` sets it, so the hook always knows whose page to write to.
 *
 * The budget lives here for a different reason. Depth is supposed to be a
 * decision the agent makes per contact, and a decision needs something to spend
 * — a counter in a prompt is a suggestion, a counter in durable state is a
 * limit that survives a crash mid-run.
 */
export const focus = defineState("crm.focus", () => ({
	contactId: null as string | null,
	companyId: null as string | null,
	sessionId: null as string | null,
	/** Vendor calls made. Cheap local reads do not count against it. */
	spent: 0,
	/** Set from the task that started the session; 4 is a plain identity pass. */
	budget: 4,
}));

/**
 * The state, or nothing, if we are not inside an eve turn.
 *
 * `get()` throws outside framework-managed code, which is right for a tool and
 * wrong for everything else that shares this library: a test, a backfill
 * script, or the dispatcher deciding what to run next. Provenance is worth
 * having even when the session id is not.
 */
export function currentFocus(): {
	contactId: string | null;
	sessionId: string | null;
} {
	try {
		const state = focus.get();
		return { contactId: state.contactId, sessionId: state.sessionId };
	} catch {
		return { contactId: null, sessionId: null };
	}
}

export function focusOn(input: {
	contactId?: string | null;
	companyId?: string | null;
	sessionId?: string | null;
}): void {
	focus.update((current) => ({
		...current,
		contactId: input.contactId ?? current.contactId,
		companyId: input.companyId ?? current.companyId,
		sessionId: input.sessionId ?? current.sessionId,
	}));
}

/** Charges a vendor call against the budget, or explains why it cannot. */
export function spend(units = 1): { ok: true } | { ok: false; reason: string } {
	const { spent, budget } = focus.get();

	if (spent + units > budget) {
		return {
			ok: false,
			reason:
				`Research budget for this contact is spent (${spent}/${budget}). ` +
				"Write up what you already have, or schedule a recheck with a reason. Do not keep looking.",
		};
	}

	focus.update((current) => ({ ...current, spent: current.spent + units }));
	return { ok: true };
}

export function setBudget(budget: number): void {
	focus.update((current) => ({ ...current, budget }));
}
