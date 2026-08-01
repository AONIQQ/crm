import { db } from "@crm/db";
import { brandToUpdate } from "../src/enrichment/brand-mapping";

/**
 * Fills `iconDarkUrl` and `iconTone` from the Context.dev payloads we already
 * stored.
 *
 * The whole point of keeping `CompanyEnrichment.raw` was that deriving a new
 * field later should cost nothing and no credits — this is that promise being
 * collected. Re-running is safe: `brandToUpdate` only fills fields that are
 * currently empty, so a value a human has since corrected is left alone.
 *
 *   bun run scripts/backfill-icon-tone.ts
 */
const rows = await db.companyEnrichment.findMany({
	select: {
		companyId: true,
		raw: true,
		company: {
			select: {
				name: true,
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
		},
	},
});

let updated = 0;

for (const row of rows) {
	const brand = (row.raw as { brand?: unknown } | null)?.brand;
	if (!brand) continue;

	const update = brandToUpdate(brand as never, {
		...row.company,
		nameIsPlaceholder: false,
	});

	// Only the two new fields — this script is not a re-enrichment.
	const patch = {
		...(update.iconDarkUrl ? { iconDarkUrl: update.iconDarkUrl } : {}),
		...(update.iconTone ? { iconTone: update.iconTone } : {}),
	};

	if (Object.keys(patch).length === 0) continue;

	await db.company.update({ where: { id: row.companyId }, data: patch });
	updated += 1;
	console.log(`${row.company.name}: ${JSON.stringify(patch)}`);
}

console.log(`\nUpdated ${updated} of ${rows.length} enriched companies.`);
await db.$disconnect();
