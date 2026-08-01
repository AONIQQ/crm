const HOST = "linkdapi-best-unofficial-linkedin-api.p.rapidapi.com";
const TIMEOUT_MS = 20_000;

/**
 * LinkedIn data via LinkDAPI on RapidAPI.
 *
 * **There is deliberately no search function here.** LinkDAPI publishes no
 * people-search endpoint, and the undocumented `/search/people?keywords=` path
 * answers `HTTP 200` with entirely unrelated people — a query for "Abbie Bigham"
 * returned Lavazza's CEO, and a different random set on the next call. Anything
 * that looked like search here would be a well-typed way to file a stranger
 * against a real customer. Finding the slug is Perplexity's job.
 *
 * Given a slug this API is excellent, so that is all it is asked to do.
 */

export type Profile = {
	slug: string;
	profileUrl: string;
	fullName: string | null;
	firstName: string | null;
	lastName: string | null;
	headline: string | null;
	location: string | null;
	/** Needed by every detail endpoint — they take `urn`, not `username`. */
	urn: string | null;
	followerCount: number | null;
	connectionsCount: number | null;
	/** Current employers. The job-change signal lives here. */
	positions: { name: string; url: string | null }[];
};

export type Company = {
	id: string | null;
	name: string | null;
	universalName: string | null;
	tagline: string | null;
	description: string | null;
	linkedinUrl: string | null;
};

export type Experience = {
	title: string | null;
	company: string | null;
	dateRange: string | null;
	location: string | null;
};

type Outcome<T> =
	| { ok: true; data: T }
	| { ok: false; missing: true }
	| { ok: false; missing: false; reason: string };

function key(): string | null {
	return process.env.RAPIDAPI_KEY ?? null;
}

export function linkedinEnabled(): boolean {
	return key() !== null;
}

/** A profile by its `linkedin.com/in/<slug>` handle. */
export async function getProfile(slug: string): Promise<Outcome<Profile>> {
	const result = await call<RawProfile>("/api/v1/profile/overview", {
		username: slug,
	});
	if (!result.ok) return result;

	const d = result.data;
	return {
		ok: true,
		data: {
			slug,
			profileUrl: `https://www.linkedin.com/in/${slug}`,
			fullName: str(d.fullName),
			firstName: str(d.firstName),
			lastName: str(d.lastName),
			headline: str(d.headline),
			location: str(d.location),
			urn: str(d.urn),
			followerCount: int(d.followerCount),
			connectionsCount: int(d.connectionsCount),
			positions: (d.CurrentPositions ?? []).flatMap((p) =>
				p?.name ? [{ name: p.name, url: str(p.url) }] : [],
			),
		},
	};
}

/** Full work history. Takes the `urn` from a profile, not the slug. */
export async function getExperience(
	urn: string,
): Promise<Outcome<Experience[]>> {
	const result = await call<RawExperience>("/api/v1/profile/full-experience", {
		urn,
	});
	if (!result.ok) return result;

	// The endpoint has been seen returning both a bare array and an object
	// wrapping one, so both are accepted rather than trusting either.
	const payload = result.data;
	const rows: RawExperienceRow[] = Array.isArray(payload)
		? payload
		: (payload.experience ?? payload.experiences ?? []);

	return {
		ok: true,
		data: rows.map(
			(row): Experience => ({
				title: str(row?.title),
				company: str(row?.companyName ?? row?.company),
				dateRange: str(row?.dateRange ?? row?.duration),
				location: str(row?.location),
			}),
		),
	};
}

/** Resolves a company name to LinkedIn's id. */
export async function lookupCompany(
	query: string,
): Promise<Outcome<{ id: string; displayName: string }[]>> {
	const result = await call<RawLookup>("/api/v1/companies/name-lookup", {
		query,
	});
	if (!result.ok) return result;

	return {
		ok: true,
		data: (result.data.companies ?? []).flatMap((c) =>
			c?.id ? [{ id: c.id, displayName: c.displayName ?? c.id }] : [],
		),
	};
}

/** Company detail. Takes `name` (the universal name) or `id`. */
export async function getCompany(nameOrId: string): Promise<Outcome<Company>> {
	const numeric = /^\d+$/.test(nameOrId);
	const result = await call<RawCompany>("/api/v1/companies/company/info", {
		[numeric ? "id" : "name"]: nameOrId,
	});
	if (!result.ok) return result;

	const d = result.data;
	return {
		ok: true,
		data: {
			id: str(d.id),
			name: str(d.name),
			universalName: str(d.universalName),
			tagline: str(d.tagline),
			description: str(d.description),
			linkedinUrl: str(d.linkedinUrl),
		},
	};
}

/**
 * One call.
 *
 * LinkDAPI reports a failed lookup as `200 { success: false }` rather than a
 * status code, so the envelope is what has to be read.
 */
async function call<T>(
	path: string,
	params: Record<string, string>,
): Promise<Outcome<T>> {
	const apiKey = key();
	if (!apiKey) return { ok: false, missing: false, reason: "No RAPIDAPI_KEY." };

	const url = new URL(`https://${HOST}${path}`);
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

	try {
		const response = await fetch(url, {
			headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": apiKey },
			signal: controller.signal,
		});

		if (!response.ok) {
			return { ok: false, missing: false, reason: `HTTP ${response.status}` };
		}

		const body = (await response.json()) as {
			success?: boolean;
			data?: T | null;
		};

		// "no such profile" is an ordinary answer, not something to retry.
		if (body.success !== true || body.data == null) {
			return { ok: false, missing: true };
		}

		return { ok: true, data: body.data };
	} catch (error) {
		const aborted = error instanceof Error && error.name === "AbortError";
		return {
			ok: false,
			missing: false,
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

type RawProfile = {
	fullName?: unknown;
	firstName?: unknown;
	lastName?: unknown;
	headline?: unknown;
	location?: unknown;
	urn?: unknown;
	followerCount?: unknown;
	connectionsCount?: unknown;
	CurrentPositions?: { name?: string; url?: unknown }[] | null;
};

type RawExperienceRow = {
	title?: unknown;
	companyName?: unknown;
	company?: unknown;
	dateRange?: unknown;
	duration?: unknown;
	location?: unknown;
};

type RawExperience =
	| RawExperienceRow[]
	| { experience?: RawExperienceRow[]; experiences?: RawExperienceRow[] };
type RawLookup = { companies?: { id?: string; displayName?: string }[] | null };
type RawCompany = {
	id?: unknown;
	name?: unknown;
	universalName?: unknown;
	tagline?: unknown;
	description?: unknown;
	linkedinUrl?: unknown;
};

function str(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function int(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}
