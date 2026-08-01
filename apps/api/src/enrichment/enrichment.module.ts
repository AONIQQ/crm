import { Module } from "@nestjs/common";
import { ContactEnrichmentService } from "./contact-enrichment.service";
import { ContextDevClient } from "./context-dev.client";
import { EnrichmentQueue } from "./enrichment.queue";
import { EnrichmentService } from "./enrichment.service";
import { LinkdapiClient } from "./linkdapi.client";

/**
 * The agent.
 *
 * Exports only `EnrichmentService`, so the modules that trigger enrichment
 * (companies, contacts) depend on "enrich this" rather than on the queue or the
 * HTTP client behind it.
 */
@Module({
	providers: [
		ContextDevClient,
		EnrichmentQueue,
		EnrichmentService,
		ContactEnrichmentService,
		LinkdapiClient,
	],
	exports: [EnrichmentService, ContactEnrichmentService],
})
export class EnrichmentModule {}
