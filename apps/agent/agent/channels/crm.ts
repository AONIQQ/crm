import { EnrichmentStatus } from "@crm/db";
import { defineChannel, POST } from "eve/channels";
import { settle } from "../lib/enrichment";
import { completeTask, taskSubject } from "../lib/tasks";

function taskToken(taskId: string): string {
	return `crm:task:${taskId}`;
}

function taskFromToken(token: string | undefined): string | null {
	if (!token) return null;
	const prefix = "crm:task:";
	return token.startsWith(prefix) ? token.slice(prefix.length) : null;
}

export default defineChannel({
	routes: [
		POST(
			"/internal/crm/dispatch-only",
			async () => new Response("Not found", { status: 404 }),
		),
	],

	events: {
		async "session.waiting"(_data, channel) {
			const taskId = taskFromToken(channel.continuationToken);
			if (!taskId) return;

			const subject = await completeTask(taskId, "ran");
			if (subject) await settle(subject, EnrichmentStatus.COMPLETE);
		},

		async "turn.failed"(data, channel) {
			const taskId = taskFromToken(channel.continuationToken);
			if (!taskId) return;

			const reason =
				typeof data === "object" && data && "error" in data
					? String((data as { error: unknown }).error)
					: "The research turn failed.";

			const subject = await taskSubject(taskId);
			if (subject) await settle(subject, EnrichmentStatus.FAILED, reason);
		},
	},

	async receive(input, { send }) {
		const taskId =
			typeof input.target?.taskId === "string" ? input.target.taskId : null;

		return send(input.message, {
			auth: input.auth,
			continuationToken: taskId
				? taskToken(taskId)
				: `crm:adhoc:${crypto.randomUUID()}`,
		});
	},
});
