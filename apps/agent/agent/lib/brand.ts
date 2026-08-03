import { db, EnrichmentStatus } from "@crm/db";
import { mirrorBrandImages } from "./brand-images";
import { brandToUpdate, filledFields } from "./brand-mapping";
import { brandByDomain, contextDevEnabled } from "./context-dev";

export type BrandResult = {
	enriched: boolean;
	filled?: string[];
	mirrored?: string[];
	reason?: string;
	retryable?: boolean;
};

export type Spend = (units?: number) => { ok: boolean; reason?: string };

export const FREE: Spend = () => ({ ok: true });

const COMPANY_FIELDS = {
	id: true,
	name: true,
	domain: true,
	description: true,
	logoUrl: true,
	logoDarkUrl: true,
	iconUrl: true,
	iconDarkUrl: true,
	iconTone: true,
	brandColor: true,
	industry: true,
	subIndustry: true,
	city: true,
	stateCode: true,
	country: true,
	countryCode: true,
	phone: true,
	email: true,
	linkedinUrl: true,
	twitterUrl: true,
	githubUrl: true,
	pricingUrl: true,
	careersUrl: true,
} as const;

export async function runBrand({
	companyId,
	fresh = false,
	spend = FREE,
}: {
	companyId: string;
	fresh?: boolean;
	spend?: Spend;
}): Promise<BrandResult> {
	if (!contextDevEnabled()) {
		return { enriched: false, reason: "Context.dev is not configured." };
	}

	const company = await db.company.findUnique({
		where: { id: companyId },
		select: COMPANY_FIELDS,
	});

	if (!company) return { enriched: false, reason: "No such company." };

	if (!company.domain) {
		await settle(companyId, EnrichmentStatus.SKIPPED, "No domain to look up.");
		return { enriched: false, reason: "No domain on this company." };
	}

	const charge = spend(2);
	if (!charge.ok) return { enriched: false, reason: charge.reason };

	await db.company.update({
		where: { id: companyId },
		data: {
			enrichmentStatus: EnrichmentStatus.RUNNING,
			enrichmentError: null,
		},
	});

	const result = await brandByDomain(company.domain, fresh ? 0 : undefined);

	if (result.outcome === "skipped") {
		await settle(companyId, EnrichmentStatus.SKIPPED, result.reason);
		return { enriched: false, reason: result.reason };
	}

	if (result.outcome === "failed") {
		await settle(companyId, EnrichmentStatus.FAILED, result.reason);
		return {
			enriched: false,
			reason: result.reason,
			retryable: result.retryable,
		};
	}

	const update = brandToUpdate(result.brand, {
		...company,
		nameIsPlaceholder: company.name === company.domain,
	});
	const filled = filledFields(update);

	const { mirrored } = await mirrorBrandImages(companyId, update);

	await db.$transaction([
		db.company.update({ where: { id: companyId }, data: update }),
		db.companyEnrichment.upsert({
			where: { companyId },
			create: { companyId, raw: result.raw as object },
			update: { raw: result.raw as object, fetchedAt: new Date() },
		}),
		db.company.update({
			where: { id: companyId },
			data: {
				enrichmentStatus: EnrichmentStatus.COMPLETE,
				enrichedAt: new Date(),
				enrichmentError: null,
			},
		}),
	]);

	return { enriched: true, filled, mirrored };
}

export function brandOutcome(result: BrandResult): string {
	if (!result.enriched) return result.reason ?? "Nothing to fill.";

	const filled = result.filled ?? [];
	const mirrored = result.mirrored ?? [];

	if (filled.length === 0) {
		return "Everything Context.dev returned was already on the record.";
	}

	return `Filled ${filled.join(", ")}.${mirrored.length > 0 ? ` Copied ${mirrored.length} image(s) in-house.` : ""}`;
}

async function settle(
	companyId: string,
	status: EnrichmentStatus,
	error: string,
): Promise<void> {
	await db.company.update({
		where: { id: companyId },
		data: { enrichmentStatus: status, enrichmentError: error },
	});
}
