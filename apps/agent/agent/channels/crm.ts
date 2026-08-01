import { defineChannel } from "eve/channels";

/**
 * The CRM itself, as a place work arrives from.
 *
 * The dispatcher needs a channel to hand a task to, and the built-in HTTP
 * channel is not one: it answers requests, it has no `receive` hook, and there
 * is nothing to deliver a reply *to*. This is the other shape — a channel whose
 * whole job is to start a durable session and let the tools do the writing.
 *
 * There is deliberately no delivery. A run that identifies somebody has already
 * succeeded by the time it would have something to say, because success is a
 * fact on a record rather than a message to a person. If this ever needs to
 * tell somebody something, the timeline is where it goes.
 */
export default defineChannel({
	// No inbound HTTP surface. Work reaches this channel by hand-off from the
	// dispatcher, not by request — the API queues a row, it does not call us.
	routes: [],

	async receive(input, { send }) {
		const taskId =
			typeof input.target?.taskId === "string" ? input.target.taskId : null;

		// The token is the task, which gives retries the behaviour you want for
		// free: a lease that expired mid-run is re-dispatched and *continues* the
		// same durable session rather than starting the research over. A task
		// scheduled fortnightly gets a new id each time, so two runs a fortnight
		// apart correctly share nothing.
		return send(input.message, {
			auth: input.auth,
			continuationToken: taskId
				? `crm:task:${taskId}`
				: `crm:adhoc:${crypto.randomUUID()}`,
		});
	},
});
