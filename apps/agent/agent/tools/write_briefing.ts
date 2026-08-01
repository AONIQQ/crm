import { defineTool } from "eve/tools";
import { z } from "zod";
import { writeTimelineNote } from "../lib/crm";

export default defineTool({
	description:
		"Write a short research note onto a contact's timeline, where a rep will see it on the record. Use for context worth keeping, not for confirming an identity.",
	inputSchema: z.object({
		contactId: z.string(),
		subject: z.string().max(120),
		body: z.string().describe("Short and factual. Include source URLs inline."),
		sources: z.array(z.string()).default([]),
	}),
	async execute({ contactId, subject, body, sources }) {
		const id = await writeTimelineNote(contactId, subject, body, { sources });
		return id
			? { written: true as const, activityId: id }
			: { written: false as const, reason: "No such contact." };
	},
});
