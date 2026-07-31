import { Module } from "@nestjs/common";
import { ContextDevClient } from "./context-dev.client";
import { EnrichmentQueue } from "./enrichment.queue";
import { EnrichmentService } from "./enrichment.service";

/**
 * The agent.
 *
 * Exports only `EnrichmentService`, so the modules that trigger enrichment
 * (companies, contacts) depend on "enrich this" rather than on the queue or the
 * HTTP client behind it.
 */
@Module({
	providers: [ContextDevClient, EnrichmentQueue, EnrichmentService],
	exports: [EnrichmentService],
})
export class EnrichmentModule {}
