import { defineTool } from "eve/tools";
import { z } from "zod";
import { searchTerms } from "../lib/names";
import { findProfileUrls } from "../lib/perplexity";

/**
 * Candidates, never an answer.
 *
 * The name is never taken from here — only the slug, which `get_linkedin_profile`
 * then verifies. A search for "Abbie Bigham" has returned Lavazza's CEO.
 */
export default defineTool({
	description:
		"Find candidate LinkedIn profile slugs for a work email address. Returns CANDIDATES ONLY — you must verify each with get_linkedin_profile before believing any of them.",
	inputSchema: z.object({
		email: z.string().describe("The contact's work email address."),
		companyName: z.string().describe("The company the CRM has them at."),
	}),
	async execute({ email, companyName }) {
		const local = email.split("@")[0] ?? "";
		const terms = searchTerms(local);
		const slugs = await findProfileUrls(terms, companyName);

		return {
			searchedFor: terms,
			candidateSlugs: slugs.slice(0, 5),
			note: "Unverified. Each slug must be checked with get_linkedin_profile.",
		};
	},
});
