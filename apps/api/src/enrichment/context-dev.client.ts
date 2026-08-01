import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import ContextDev from "context.dev";
import { APIError } from "context.dev/core/error";
import type { EnvironmentVariables } from "../config/env.validation";

/** The Context.dev `brand` object, narrowed to the parts we map. */
export type Brand = {
	domain?: string | null;
	title?: string | null;
	description?: string | null;
	slogan?: string | null;
	email?: string | null;
	phone?: string | null;
	colors?: { hex?: string | null; name?: string | null }[] | null;
	logos?:
		| {
				url?: string | null;
				/** "light" | "dark" | "has_opaque_background". */
				mode?: string | null;
				type?: string | null;
				/** The artwork's own dominant colours — how a dark mark is detected. */
				colors?: { hex?: string | null; name?: string | null }[] | null;
		  }[]
		| null;
	socials?: { type?: string | null; url?: string | null }[] | null;
	address?: {
		city?: string | null;
		state_code?: string | null;
		country?: string | null;
		country_code?: string | null;
	} | null;
	industries?: {
		eic?: { industry?: string | null; subindustry?: string | null }[] | null;
	} | null;
	links?: {
		pricing?: string | null;
		careers?: string | null;
	} | null;
};

/**
 * Why a lookup did not produce a brand.
 *
 * `skipped` and `failed` are deliberately different: "there is nothing to find
 * for this domain" is a settled answer that should stop us retrying and cost
 * nothing, while "the call fell over" is worth another go.
 */
export type LookupResult =
	| { outcome: "found"; brand: Brand; raw: unknown }
	| { outcome: "skipped"; reason: string }
	| { outcome: "failed"; reason: string; retryable: boolean };

/** One web search result, narrowed to the parts a person lookup reads. */
export type SearchResult = {
	url: string | null;
	title: string | null;
	description: string | null;
	markdown: string | null;
};

/** Cold lookups are p50 ≈ 7s, p90 ≈ 18s — so this is generous on purpose. */
const TIMEOUT_MS = 60_000;

@Injectable()
export class ContextDevClient {
	private readonly logger = new Logger(ContextDevClient.name);
	private readonly client: ContextDev | null;

	constructor(config: ConfigService<EnvironmentVariables, true>) {
		const apiKey = config.get("CONTEXT_DEV_API_KEY", { infer: true });

		if (!apiKey) {
			// Logged once, at boot, rather than on every company that stays PENDING.
			this.logger.warn({
				message:
					"CONTEXT_DEV_API_KEY is not set — enrichment is disabled and companies will stay PENDING.",
			});
			this.client = null;
			return;
		}

		this.client = new ContextDev({ apiKey });
	}

	get enabled(): boolean {
		return this.client !== null;
	}

	/** `POST /brand/retrieve` by domain. 10 credits, only on a successful match. */
	async brandByDomain(
		domain: string,
		maxAgeMs?: number,
	): Promise<LookupResult> {
		return this.lookup({
			type: "by_domain",
			domain,
			timeoutMS: TIMEOUT_MS,
			...(maxAgeMs === undefined ? {} : { maxAgeMs }),
		});
	}

	/** `POST /brand/retrieve` by work email — the domain is extracted for us. */
	async brandByEmail(email: string): Promise<LookupResult> {
		return this.lookup({
			type: "by_email",
			email,
			timeoutMS: TIMEOUT_MS,
		});
	}

	/**
	 * Warms the cache so a later retrieve lands sub-second. Free, and
	 * fire-and-forget: the response carries no brand data.
	 *
	 * Paid plans only — a `403` here is a plan limit, not a bug, so it is logged
	 * once and the caller falls through to a direct retrieve.
	 */
	async prefetch(domain: string): Promise<void> {
		if (!this.client) return;

		try {
			await this.client.utility.prefetch({
				type: "brand",
				identifier: { domain },
			});
		} catch (error) {
			if (error instanceof APIError && error.status === 403) {
				this.logger.debug({
					message: "Prefetch needs a paid plan — falling through to retrieve.",
					domain,
				});
				return;
			}
			this.logger.debug({
				message: "Prefetch failed; falling through to retrieve.",
				domain,
				reason: describe(error),
			});
		}
	}

	/**
	 * `POST /web/extract` against a caller-defined JSON Schema.
	 *
	 * Used for the research brief, which is not a brand lookup — it is "read this
	 * company's site and answer these questions".
	 */
	async extract(
		url: string,
		schema: Record<string, unknown>,
		instructions: string,
	): Promise<
		{ outcome: "found"; data: unknown } | { outcome: "failed"; reason: string }
	> {
		if (!this.client) {
			return { outcome: "failed", reason: "Enrichment is not configured." };
		}

		try {
			const response = await this.client.web.extract({
				url,
				schema,
				instructions,
				maxPages: 8,
				timeoutMS: TIMEOUT_MS,
			});
			return { outcome: "found", data: response.data };
		} catch (error) {
			return { outcome: "failed", reason: describe(error) };
		}
	}

	/**
	 * `POST /web/search`.
	 *
	 * Accepts Google-style operators, which is what makes a person lookup
	 * *sourced* rather than guessed: we search for evidence and read a name off a
	 * page, instead of asking a model what "abigham" probably stands for.
	 */
	async search(
		query: string,
		options: { limit?: number; excludeDomains?: string[] } = {},
	): Promise<
		| { outcome: "found"; results: SearchResult[] }
		| { outcome: "failed"; reason: string }
	> {
		if (!this.client) {
			return { outcome: "failed", reason: "Enrichment is not configured." };
		}

		try {
			const response = await this.client.web.search({
				query,
				// The API rejects anything under 10 — a smaller ask fails validation
				// rather than returning fewer results.
				numResults: Math.max(options.limit ?? 10, 10),
				// Without this the results are titles and snippets only, and a name
				// is usually in the page rather than the snippet.
				markdownOptions: { enabled: true },
				...(options.excludeDomains
					? { excludeDomains: options.excludeDomains }
					: {}),
			});

			const results = (response.results ?? []).map((result) => ({
				url: result.url ?? null,
				title: result.title ?? null,
				description: result.description ?? null,
				// `code` is the per-result scrape outcome; anything but SUCCESS means
				// `markdown` is null and the snippet is all we have.
				markdown:
					result.markdown?.code === "SUCCESS"
						? (result.markdown.markdown ?? null)
						: null,
			}));

			return { outcome: "found", results };
		} catch (error) {
			return { outcome: "failed", reason: describe(error) };
		}
	}

	private async lookup(
		params: Parameters<ContextDev["brand"]["retrieve"]>[0],
	): Promise<LookupResult> {
		if (!this.client) {
			return {
				outcome: "skipped",
				reason: "Enrichment is not configured.",
			};
		}

		try {
			const response = await this.client.brand.retrieve(params);
			const brand = response.brand as Brand | undefined;

			if (!brand) {
				return { outcome: "skipped", reason: "No brand matched." };
			}

			return { outcome: "found", brand, raw: response };
		} catch (error) {
			return classify(error);
		}
	}
}

/**
 * Maps Context.dev's failures onto something the CRM can act on.
 *
 * The important distinction is which of these should leave a company retryable.
 * An unknown domain never becomes known by asking again; a timeout might.
 */
function classify(error: unknown): LookupResult {
	if (!(error instanceof APIError)) {
		return { outcome: "failed", reason: describe(error), retryable: true };
	}

	const code = errorCode(error);

	// 400 covers both malformed input and "we looked, there is nothing there".
	// Neither is billed, and neither is worth retrying.
	if (error.status === 400) {
		if (code === "NOT_FOUND" || code === "WEBSITE_ACCESS_ERROR") {
			return {
				outcome: "skipped",
				reason:
					code === "NOT_FOUND"
						? "No brand matched this domain."
						: "The site could not be reached.",
			};
		}
		return { outcome: "failed", reason: describe(error), retryable: false };
	}

	// A personal or throwaway address says nothing about where someone works.
	if (error.status === 422) {
		return {
			outcome: "skipped",
			reason: "That is a personal or disposable email address.",
		};
	}

	if (error.status === 401 || error.status === 403) {
		return { outcome: "failed", reason: describe(error), retryable: false };
	}

	// Cold-cache timeouts and rate limits are the retryable ones.
	if (error.status === 408 || error.status === 429) {
		return { outcome: "failed", reason: describe(error), retryable: true };
	}

	return {
		outcome: "failed",
		reason: describe(error),
		retryable: (error.status ?? 500) >= 500,
	};
}

function errorCode(error: APIError): string | undefined {
	const body = error.error as { error_code?: unknown } | undefined;
	return typeof body?.error_code === "string" ? body.error_code : undefined;
}

function describe(error: unknown): string {
	if (error instanceof APIError) {
		return `${error.status ?? "?"} ${errorCode(error) ?? error.message}`;
	}
	return error instanceof Error ? error.message : String(error);
}
