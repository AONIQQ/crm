import { db, EnrichmentStatus } from "@crm/db";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { mirrorBrandImages } from "../lib/brand-images";
import { brandToUpdate, filledFields } from "../lib/brand-mapping";
import { brandByDomain, contextDevEnabled } from "../lib/context-dev";
import { spend } from "../lib/focus";

export default defineTool({
	description:
		"Look up a company's brand, industry, location and social links by domain, and fill in the blanks on its record. Fills empty fields only — never overwrites what a person typed.",
	inputSchema: z.object({
		companyId: z.string(),
		fresh: z
			.boolean()
			.default(false)
			.describe(
				"Bypass the vendor's ~90-day cache. Only when a rep has asked for a fresh look.",
			),
	}),
	async execute({ companyId, fresh }) {
		if (!contextDevEnabled()) {
			return {
				enriched: false as const,
				reason: "Context.dev is not configured.",
			};
		}

		const company = await db.company.findUnique({
			where: { id: companyId },
			select: {
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
			},
		});

		if (!company)
			return { enriched: false as const, reason: "No such company." };
		if (!company.domain) {
			await settle(
				companyId,
				EnrichmentStatus.SKIPPED,
				"No domain to look up.",
			);
			return { enriched: false as const, reason: "No domain on this company." };
		}

		const charge = spend(2);
		if (!charge.ok) return { enriched: false as const, reason: charge.reason };

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
			return { enriched: false as const, reason: result.reason };
		}

		if (result.outcome === "failed") {
			await settle(companyId, EnrichmentStatus.FAILED, result.reason);
			return {
				enriched: false as const,
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

		return {
			enriched: true as const,
			filled,
			mirrored,
			note:
				filled.length === 0
					? "Everything it returned was already on the record."
					: undefined,
		};
	},
});

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
