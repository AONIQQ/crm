import { defineTool } from "eve/tools";
import { z } from "zod";
import { contactsNeedingResearch } from "../lib/crm";

export default defineTool({
	description:
		"List CRM contacts whose name is still derived from their email address and so need identifying. Returns the evidence to research them with.",
	inputSchema: z.object({
		limit: z.number().int().min(1).max(25).default(10),
	}),
	async execute({ limit }) {
		const contacts = await contactsNeedingResearch(limit);
		return { count: contacts.length, contacts };
	},
});
