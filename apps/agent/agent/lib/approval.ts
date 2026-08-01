import type { Approval } from "eve/tools";

/**
 * Who is driving, and what that licenses.
 *
 * Two facts shape every approval decision in this agent:
 *
 * 1. eve's own guidance is that model behaviour must not be relied on to
 *    prevent sensitive writes. A confidence rubric in a system prompt *is*
 *    model behaviour.
 * 2. **A task-mode schedule cannot pause for a person.** "Ask a human when
 *    unsure" is therefore not available to a cron run — asking would hang it.
 *    The same tool has to behave differently depending on who called it.
 *
 * Note what is deliberately *not* gated: `record_fact`. Its band logic runs in
 * the same function that scores the evidence, so a weak claim cannot be written
 * however the model asks. An approval gate there could only reject calls the
 * tool already rejects, while breaking the thing that makes weak claims
 * useful — being stored as a suggestion. Gates go on writes whose blast radius
 * is bigger than one field.
 */

/** eve's app principal, used by markdown schedules and the dispatcher. */
export function isAutomated(session: {
	auth: {
		current?: {
			authenticator?: string;
			principalId?: string;
			principalType?: string;
		} | null;
	};
}): boolean {
	const auth = session.auth.current;
	return (
		auth?.authenticator === "app" &&
		auth.principalId === "eve:app" &&
		auth.principalType === "runtime"
	);
}

/**
 * For writes that move a record rather than fill a field.
 *
 * Re-parenting a contact to a different company is the example: it changes
 * whose pipeline they are in and which timeline their history hangs off, and
 * getting it wrong is not a typo somebody spots. A person signs it off, or it
 * does not happen unattended.
 */
export function sensitiveWrite(instead: string): Approval {
	return ({ session }) =>
		isAutomated(session)
			? {
					type: "denied" as const,
					reason: `Not something to do unattended. ${instead}`,
				}
			: "user-approval";
}
