import { db } from "@crm/db";
import { defineHook } from "eve/hooks";
import { currentFocus } from "../lib/focus";

/**
 * Every runtime event, on the record it was about.
 *
 * This is what "show your work" reads. Without it the agent's reasoning exists
 * only in a log nobody can query, and the contact sheet can say *what* a field
 * is but never *how it got there* — which is the whole difference between this
 * and buying a record from a data vendor.
 *
 * `meta.id` is eve's own ULID, minted once when the event is written to the
 * durable stream and stable across reconnects, rewinds and replays. Using it as
 * the primary key with `skipDuplicates` is what makes ingestion idempotent: a
 * reconnect mid-turn re-delivers events we already have, and they land as
 * no-ops instead of duplicate rows. Leading with a timestamp keeps inserts
 * roughly append-ordered too.
 *
 * Hooks are observe-only and run after the event is durably recorded, so a
 * failure in here can never take a turn down with it — but it must not throw
 * either, which is why the write is wrapped.
 */
export default defineHook({
	events: {
		async "*"(event, ctx) {
			const id = event.meta?.id;

			// Events written before eve stream version 20 carry no id. They cannot
			// be deduplicated, so they are not stored rather than risking a
			// duplicate history — the exposure ends with the sessions that predate
			// the upgrade.
			if (!id) return;

			try {
				await db.agentEvent.createMany({
					data: [
						{
							id,
							sessionId: ctx.session.id,
							contactId: currentFocus().contactId,
							type: event.type,
							// Not every event carries a payload — `session.completed`
							// is the whole event. The column is non-null, so those
							// store an empty object rather than being dropped.
							data: ("data" in event ? (event.data ?? {}) : {}) as object,
							emittedAt: event.meta?.at ? new Date(event.meta.at) : new Date(),
						},
					],
					skipDuplicates: true,
				});
			} catch (error) {
				// Never let the audit trail break the work it is auditing.
				console.warn("[audit] could not record event", {
					type: event.type,
					reason: error instanceof Error ? error.message : String(error),
				});
			}
		},
	},
});
