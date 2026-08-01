import { defineTool } from "eve/tools";
import { z } from "zod";
import { patchContact } from "../lib/crm";
import { splitName } from "../lib/names";

/**
 * The only write.
 *
 * Requires a source URL and a confidence, and refuses anything below `high`.
 * The bar is enforced here rather than in the prompt because a rubric the model
 * is asked to follow is a rubric the model can talk itself out of.
 */
export default defineTool({
	description:
		"Write a verified identity onto a CRM contact. Only accepts high-confidence matches with a source URL. Never overwrites a field a human has filled in.",
	inputSchema: z.object({
		contactId: z.string(),
		fullName: z.string().describe("Exactly as written on the source."),
		title: z.string().optional(),
		linkedinUrl: z.string().optional(),
		sourceUrl: z.string().describe("The page this came from."),
		confidence: z
			.enum(["high", "medium", "low"])
			.describe(
				"From get_linkedin_profile's verdict. Do not raise it yourself.",
			),
	}),
	async execute(input) {
		if (input.confidence !== "high") {
			return {
				written: false as const,
				reason:
					`Confidence is ${input.confidence}. Only high-confidence matches are written — ` +
					"both the employer and the name must match. Leave the contact as it is.",
			};
		}

		const name = splitName(input.fullName);
		if (!name) {
			return { written: false as const, reason: "Unusable name." };
		}

		const { changed } = await patchContact(input.contactId, {
			firstName: name.firstName,
			lastName: name.lastName,
			title: input.title,
			linkedinUrl: input.linkedinUrl,
		});

		return {
			written: changed.length > 0,
			changed,
			note:
				changed.length === 0
					? "Nothing changed — a human had already filled these in."
					: undefined,
		};
	},
});
