import { defineSchedule } from "eve/schedules";
import crm from "../channels/crm";
import { claimDue, completeTask } from "../lib/tasks";

/** Per tick. The cap is concurrency, not ambition — the queue keeps. */
const BATCH = 5;

/**
 * The agent's clock.
 *
 * One schedule for everything, and it decides nothing: it leases whatever is
 * due and starts a session per row. What the work *is* comes from the row —
 * written by the API when something happened, or by the agent itself when it
 * decided a person was worth another look in a fortnight.
 *
 * This is the difference the plan is named for. The schedules it replaces said
 * "every 20 minutes, the ten oldest contacts", which treats the CEO of a live
 * opportunity and a bounced alias identically because they sorted adjacently.
 *
 * Handler form rather than markdown, because the batch has to be claimed in
 * code — and because a handler-form session can park for a human, which task
 * mode cannot.
 */
export default defineSchedule({
	cron: "* * * * *",
	async run({ receive, waitUntil, appAuth }) {
		waitUntil(
			(async () => {
				const tasks = await claimDue(BATCH);
				if (tasks.length === 0) return;

				await Promise.all(
					tasks.map(async (task) => {
						try {
							await receive(crm, {
								message: brief(task),
								// The channel keys its continuation token off this, so a
								// re-dispatched lease resumes the run rather than starting
								// the research over.
								target: { taskId: task.id },
								auth: {
									...appAuth,
									// Read by `instructions/task.ts` at `session.started`, so
									// the run opens knowing who it is about and what it may
									// spend instead of paying two tool calls to find out.
									attributes: {
										taskKind: task.kind,
										reason: task.reason,
										budget: String(task.budget),
										...(task.contactId ? { contactId: task.contactId } : {}),
										...(task.companyId ? { companyId: task.companyId } : {}),
									},
								},
							});

							await completeTask(task.id, "ran");
						} catch (error) {
							// The lease expires on its own, so a failure here is a retry
							// later rather than a row nobody ever picks up again.
							await completeTask(
								task.id,
								`failed: ${error instanceof Error ? error.message : String(error)}`,
							);
						}
					}),
				);
			})(),
		);
	},
});

/**
 * What the session is asked to do.
 *
 * Short on purpose. The detail — who this person is, what we already know, what
 * is missing — is assembled by the dynamic instructions from the database,
 * where it is current, rather than pasted into a prompt here, where it would be
 * a snapshot taken by whoever queued the row.
 */
function brief(task: {
	kind: string;
	reason: string;
	contactId: string | null;
	companyId: string | null;
}): string {
	switch (task.kind) {
		case "identify":
			return "Work out who this contact actually is, and record what you find. Read what we already have before spending anything.";
		case "profile":
		case "recheck":
			return "Bring this contact's record up to date: their background, their current role, and anything that has changed since we last looked.";
		case "meeting-prep":
			return "There is a meeting with this person soon. Make sure whoever is taking it opens the record knowing who they are dealing with.";
		case "company-profile":
			return "Fill in what we know about this company: brand, industry, location, links. Write a brief if there is something worth saying.";
		default:
			return `Handle this: ${task.reason}`;
	}
}
