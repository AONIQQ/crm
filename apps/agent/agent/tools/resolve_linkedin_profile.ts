import { defineTool } from "eve/tools";
import { z } from "zod";
import { enabled, unavailable } from "../lib/capabilities";
import { spend } from "../lib/focus";
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
		// Finding the slug is Perplexity's job — see `lib/linkdapi.ts` for why
		// LinkDAPI is never asked to search. Without it there is no way in to a
		// profile, so this stops here rather than charging for a lookup that has
		// nowhere to look.
		if (!enabled("PERPLEXITY_API_KEY")) {
			return { candidateSlugs: [], ...unavailable("PERPLEXITY_API_KEY") };
		}

		const charge = spend();
		if (!charge.ok) return { candidateSlugs: [], note: charge.reason };

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
