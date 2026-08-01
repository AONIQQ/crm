import { Module } from "@nestjs/common";
import { AgentTriggerService } from "./agent-trigger.service";

/**
 * The API's entire relationship with the research agent.
 *
 * One service, one verb: *this happened*. What replaced `EnrichmentModule` is
 * smaller than the module docstring it replaced, which is the point — there is
 * no queue here, no vendor client, and nothing that knows what a LinkedIn
 * profile is.
 */
@Module({
	providers: [AgentTriggerService],
	exports: [AgentTriggerService],
})
export class AgentModule {}
