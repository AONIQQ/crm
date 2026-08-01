import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "../config/env.validation";

const HOST = "linkdapi-best-unofficial-linkedin-api.p.rapidapi.com";
const TIMEOUT_MS = 20_000;

/** A LinkedIn profile, narrowed to the parts the CRM stores or renders. */
export type LinkedInProfile = {
	slug: string;
	fullName: string | null;
	firstName: string | null;
	lastName: string | null;
	headline: string | null;
	location: string | null;
	pictureUrl: string | null;
	followerCount: number | null;
	connectionsCount: number | null;
	/** Current employers, newest first. The job-change signal lives here. */
	positions: { name: string; url: string | null }[];
	profileUrl: string;
};

export type LinkedInCompany = {
	id: string | null;
	name: string | null;
	universalName: string | null;
	tagline: string | null;
	description: string | null;
	linkedinUrl: string | null;
};

type Result<T> =
	| { outcome: "found"; data: T }
	| { outcome: "missing" }
	| { outcome: "failed"; reason: string };

/**
 * LinkedIn profile data, via LinkDAPI on RapidAPI.
 *
 * **This client deliberately exposes no search.** LinkDAPI's
 * `/search/people?keywords=` returns HTTP 200 with entirely unrelated people —
 * "Abbie Bigham" came back as a list of Italian executives, and a different
 * random set on every call. It is not rate limiting or a bad query; the
 * parameter is ignored. Anything that looks like a search here would be a
 * plausible-looking way to file a stranger against a real customer.
 *
 * So this is an *enricher*: give it a profile slug and it is excellent. Finding
 * the slug is `ContextDevClient.search`'s job — see
 * `ContactEnrichmentService`.
 */
@Injectable()
export class LinkdapiClient {
	private readonly logger = new Logger(LinkdapiClient.name);
	private readonly apiKey: string | undefined;

	constructor(config: ConfigService<EnvironmentVariables, true>) {
		this.apiKey = config.get("RAPIDAPI_KEY", { infer: true });

		if (!this.apiKey) {
			// Once, at boot, mirroring how a missing Context.dev key is reported.
			this.logger.warn({
				message:
					"RAPIDAPI_KEY is not set — LinkedIn enrichment is disabled and contacts keep their derived names.",
			});
		}
	}

	get enabled(): boolean {
		return Boolean(this.apiKey);
	}

	/** A profile by its `linkedin.com/in/<slug>` handle. */
	async profile(slug: string): Promise<Result<LinkedInProfile>> {
		const result = await this.get<RawProfile>("/api/v1/profile/overview", {
			username: slug,
		});

		if (result.outcome !== "found") return result;

		const data = result.data;

		return {
			outcome: "found",
			data: {
				slug,
				fullName: text(data.fullName),
				firstName: text(data.firstName),
				lastName: text(data.lastName),
				headline: text(data.headline),
				location: text(data.location),
				pictureUrl: text(data.profilePictureURL),
				followerCount: num(data.followerCount),
				connectionsCount: num(data.connectionsCount),
				positions: (data.CurrentPositions ?? []).flatMap((position) =>
					position?.name
						? [{ name: position.name, url: text(position.url) }]
						: [],
				),
				profileUrl: `https://www.linkedin.com/in/${slug}`,
			},
		};
	}

	/** A company by its `linkedin.com/company/<slug>` handle. Takes `name`. */
	async company(slug: string): Promise<Result<LinkedInCompany>> {
		const result = await this.get<RawCompany>(
			"/api/v1/companies/company/info",
			{ name: slug },
		);

		if (result.outcome !== "found") return result;

		const data = result.data;

		return {
			outcome: "found",
			data: {
				id: text(data.id),
				name: text(data.name),
				universalName: text(data.universalName),
				tagline: text(data.tagline),
				description: text(data.description),
				linkedinUrl: text(data.linkedinUrl),
			},
		};
	}

	/**
	 * One call.
	 *
	 * LinkDAPI answers a failed lookup with `200 { success: false }` rather than
	 * a status code, so the envelope has to be read rather than the response.
	 */
	private async get<T>(
		path: string,
		params: Record<string, string>,
	): Promise<Result<T>> {
		if (!this.apiKey) return { outcome: "failed", reason: "No RAPIDAPI_KEY." };

		const url = new URL(`https://${HOST}${path}`);
		for (const [key, value] of Object.entries(params)) {
			url.searchParams.set(key, value);
		}

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

		try {
			const response = await fetch(url, {
				headers: {
					"x-rapidapi-host": HOST,
					"x-rapidapi-key": this.apiKey,
				},
				signal: controller.signal,
			});

			if (!response.ok) {
				return { outcome: "failed", reason: `HTTP ${response.status}` };
			}

			const body = (await response.json()) as {
				success?: boolean;
				message?: string;
				data?: T | null;
			};

			if (body.success !== true || !body.data) {
				// "no such profile" is an ordinary answer, not a failure to retry.
				return { outcome: "missing" };
			}

			return { outcome: "found", data: body.data };
		} catch (error) {
			const aborted = error instanceof Error && error.name === "AbortError";
			return {
				outcome: "failed",
				reason: aborted
					? `Timed out after ${TIMEOUT_MS}ms.`
					: error instanceof Error
						? error.message
						: String(error),
			};
		} finally {
			clearTimeout(timeout);
		}
	}
}

type RawProfile = {
	fullName?: unknown;
	firstName?: unknown;
	lastName?: unknown;
	headline?: unknown;
	location?: unknown;
	profilePictureURL?: unknown;
	followerCount?: unknown;
	connectionsCount?: unknown;
	CurrentPositions?: { name?: string; url?: unknown }[] | null;
};

type RawCompany = {
	id?: unknown;
	name?: unknown;
	universalName?: unknown;
	tagline?: unknown;
	description?: unknown;
	linkedinUrl?: unknown;
};

function text(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}
