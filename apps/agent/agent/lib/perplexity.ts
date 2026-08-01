const ENDPOINT = "https://api.perplexity.ai/chat/completions";
const TIMEOUT_MS = 45_000;

/**
 * Perplexity, for the two things it is better at than anything else here:
 * finding where a person lives on the web, and saying what has happened
 * recently that a rep should know before a call.
 *
 * It is **not** the source of truth for identity. Asked for Abbie Bigham's job
 * title it answered "Account Executive L3" while her own LinkedIn profile says
 * "Growth Specialist at HubSpot" — an aggregator reconciling stale sources.
 * LinkedIn is self-reported and wins on identity; Perplexity wins on context.
 *
 * Every answer carries its citations, and a claim without one does not get
 * written to a record.
 */

export type Answer = {
	text: string;
	citations: string[];
};

type Outcome<T> = { ok: true; data: T } | { ok: false; reason: string };

export function perplexityEnabled(): boolean {
	return Boolean(process.env.PERPLEXITY_API_KEY);
}

export type AskOptions = {
	/** `sonar` is fast and cited; `sonar-pro` reasons harder over more sources. */
	model?: "sonar" | "sonar-pro";
	/** Narrow the search, e.g. `["linkedin.com"]`. */
	domains?: string[];
	system?: string;
};

/** One grounded question. */
export async function ask(
	question: string,
	options: AskOptions = {},
): Promise<Outcome<Answer>> {
	const apiKey = process.env.PERPLEXITY_API_KEY;
	if (!apiKey) return { ok: false, reason: "No PERPLEXITY_API_KEY." };

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

	try {
		const response = await fetch(ENDPOINT, {
			method: "POST",
			headers: {
				authorization: `Bearer ${apiKey}`,
				"content-type": "application/json",
			},
			signal: controller.signal,
			body: JSON.stringify({
				model: options.model ?? "sonar",
				messages: [
					...(options.system
						? [{ role: "system", content: options.system }]
						: []),
					{ role: "user", content: question },
				],
				...(options.domains ? { search_domain_filter: options.domains } : {}),
			}),
		});

		if (!response.ok) {
			return { ok: false, reason: `HTTP ${response.status}` };
		}

		const body = (await response.json()) as {
			choices?: { message?: { content?: string } }[];
			citations?: string[];
			search_results?: { url?: string }[];
		};

		const text = body.choices?.[0]?.message?.content?.trim() ?? "";
		if (!text) return { ok: false, reason: "Empty answer." };

		// The field moved between API versions; read whichever is present rather
		// than dropping citations on a version bump.
		const citations =
			body.citations ??
			(body.search_results ?? []).flatMap((r) => (r.url ? [r.url] : []));

		return { ok: true, data: { text, citations } };
	} catch (error) {
		const aborted = error instanceof Error && error.name === "AbortError";
		return {
			ok: false,
			reason: aborted
				? `Timed out after ${TIMEOUT_MS}ms.`
				: error instanceof Error
					? error.message
					: String(error),
		};
	} finally {
		clearTimeout(timer);
	}
}

/**
 * LinkedIn profile URLs for a person, from their email and employer.
 *
 * Restricted to linkedin.com so the answer is a set of URLs rather than prose,
 * and the slugs are pulled out of the citations rather than out of the model's
 * text — a cited URL was actually retrieved, a quoted one may not have been.
 */
export async function findProfileUrls(
	terms: string[],
	companyName: string,
): Promise<string[]> {
	const slugs: string[] = [];

	for (const term of terms) {
		const answer = await ask(
			`Find the LinkedIn profile of the person called "${term}" who works at ${companyName}. Reply with their profile URL only.`,
			{ domains: ["linkedin.com"] },
		);

		if (!answer.ok) continue;

		const haystack = [answer.data.text, ...answer.data.citations].join(" ");
		for (const match of haystack.matchAll(
			/linkedin\.com\/in\/([A-Za-z0-9\-_%]+)/g,
		)) {
			const slug = match[1];
			if (slug && !slugs.includes(slug)) slugs.push(slug);
		}

		// The first term that produces anything is the most specific one.
		if (slugs.length > 0) break;
	}

	return slugs;
}
