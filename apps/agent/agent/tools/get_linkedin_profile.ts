import { defineTool } from "eve/tools";
import { z } from "zod";
import { enabled, unavailable } from "../lib/capabilities";
import { spend } from "../lib/focus";
import { getExperience, getProfile } from "../lib/linkdapi";
import { looksLikeSameCompany, nameMatchesLocalPart } from "../lib/names";

/**
 * Reads a candidate and judges it, rather than handing the model a profile and
 * hoping. The two checks are the thing standing between a search result and a
 * customer record.
 */
export default defineTool({
	description:
		"Read a LinkedIn profile by slug and check whether it is really the person behind an email address. Returns the profile plus an explicit verdict.",
	inputSchema: z.object({
		slug: z.string().describe("The linkedin.com/in/<slug> handle."),
		email: z.string().describe("The address we are trying to identify."),
		companyName: z.string(),
		companyDomain: z.string(),
		includeHistory: z
			.boolean()
			.default(false)
			.describe("Also fetch full work history — costs an extra call."),
	}),
	async execute({ slug, email, companyName, companyDomain, includeHistory }) {
		if (!enabled("RAPIDAPI_KEY")) {
			return { found: false as const, ...unavailable("RAPIDAPI_KEY") };
		}

		// Charged before the call, not after: a budget that only counts successes
		// is a budget an unlucky contact can blow through four times over.
		const charge = spend(includeHistory ? 2 : 1);
		if (!charge.ok) return { found: false as const, reason: charge.reason };

		const result = await getProfile(slug);
		if (!result.ok) {
			return result.missing
				? { found: false as const, reason: "No such profile." }
				: { found: false as const, reason: result.reason };
		}

		const profile = result.data;
		const local = email.split("@")[0] ?? "";

		const employerMatches = profile.positions.some((position) =>
			looksLikeSameCompany(position.name, companyName, companyDomain),
		);
		const nameMatches = nameMatchesLocalPart(profile, local);

		const history =
			includeHistory && profile.urn ? await getExperience(profile.urn) : null;

		return {
			found: true as const,
			profile,
			experience: history?.ok ? history.data : null,
			verdict: {
				employerMatches,
				nameMatches,
				// Both, or it is not them. Stated as a decision rather than as two
				// facts so there is nothing to reinterpret.
				isSamePerson: employerMatches && nameMatches,
				confidence:
					employerMatches && nameMatches
						? ("high" as const)
						: employerMatches || nameMatches
							? ("medium" as const)
							: ("low" as const),
			},
		};
	},
});
