import type { Prisma } from "@crm/db";
import type { Brand } from "./context-dev.client";

/**
 * What the agent is allowed to change about a company.
 *
 * Every field Context.dev returns is nullable, and a human's typed-in value
 * always outranks a guess: this only ever *fills gaps*. Nothing here overwrites
 * something that is already set, which is why every assignment goes through
 * `fill`.
 */
export type BrandUpdate = Prisma.CompanyUpdateInput;

/** The current values, so we know which gaps there are to fill. */
export type CompanySnapshot = {
	name: string;
	/** True when the record was created domain-first and never named by a human. */
	nameIsPlaceholder: boolean;
	description: string | null;
	logoUrl: string | null;
	logoDarkUrl: string | null;
	iconUrl: string | null;
	brandColor: string | null;
	industry: string | null;
	subIndustry: string | null;
	city: string | null;
	stateCode: string | null;
	country: string | null;
	countryCode: string | null;
	phone: string | null;
	email: string | null;
	linkedinUrl: string | null;
	twitterUrl: string | null;
	githubUrl: string | null;
	pricingUrl: string | null;
	careersUrl: string | null;
};

/**
 * Picks a logo by `mode` and `type` rather than taking `logos[0]`.
 *
 * The array is not ordered by usefulness: taking the first one is how you end
 * up with a dark-mode wordmark on a white table row.
 */
function pickLogo(
	logos: Brand["logos"],
	type: "logo" | "icon",
	mode?: "light" | "dark",
): string | null {
	const candidates = (logos ?? []).filter(
		(logo) =>
			logo?.url &&
			logo.type === type &&
			(mode === undefined || logo.mode === mode),
	);
	return candidates[0]?.url ?? null;
}

function social(socials: Brand["socials"], type: string): string | null {
	return (socials ?? []).find((entry) => entry?.type === type)?.url ?? null;
}

function clean(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

/**
 * Builds the Prisma update for a brand lookup.
 *
 * Returns only the fields that are currently empty and that the lookup actually
 * found, so re-enriching a company a rep has been editing does not undo their
 * work.
 */
export function brandToUpdate(
	brand: Brand,
	current: CompanySnapshot,
): BrandUpdate {
	const update: BrandUpdate = {};

	const fill = <K extends keyof CompanySnapshot & keyof BrandUpdate>(
		key: K,
		value: string | null,
	) => {
		if (value && current[key as keyof CompanySnapshot] === null) {
			(update as Record<string, unknown>)[key] = value;
		}
	};

	// The one non-null field the agent may replace: a company created from a
	// domain alone is named after the domain until we know better.
	const title = clean(brand.title);
	if (title && current.nameIsPlaceholder) {
		update.name = title;
	}

	fill("description", clean(brand.description) ?? clean(brand.slogan));

	fill("logoUrl", pickLogo(brand.logos, "logo", "light"));
	fill("logoDarkUrl", pickLogo(brand.logos, "logo", "dark"));
	// Icons rarely declare a mode, so this one is not filtered by it.
	fill("iconUrl", pickLogo(brand.logos, "icon"));

	// `colors[].name` is generated rather than the brand's own name for it, so
	// the hex is the only part worth storing.
	fill("brandColor", clean(brand.colors?.[0]?.hex));

	const eic = brand.industries?.eic?.[0];
	fill("industry", clean(eic?.industry));
	fill("subIndustry", clean(eic?.subindustry));

	fill("city", clean(brand.address?.city));
	fill("stateCode", clean(brand.address?.state_code));
	fill("country", clean(brand.address?.country));
	fill("countryCode", clean(brand.address?.country_code));

	fill("phone", clean(brand.phone));
	fill("email", clean(brand.email));

	fill("linkedinUrl", social(brand.socials, "linkedin"));
	fill(
		"twitterUrl",
		social(brand.socials, "x") ?? social(brand.socials, "twitter"),
	);
	fill("githubUrl", social(brand.socials, "github"));

	fill("pricingUrl", clean(brand.links?.pricing));
	fill("careersUrl", clean(brand.links?.careers));

	return update;
}

/** Fields worth counting when logging what a lookup actually achieved. */
export function filledFields(update: BrandUpdate): string[] {
	return Object.keys(update);
}
