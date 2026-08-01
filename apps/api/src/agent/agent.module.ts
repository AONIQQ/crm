import { Module } from "@nestjs/common";
import { AgentQueueService } from "./agent-queue.service";
import { AgentTriggerService } from "./agent-trigger.service";

/**
 * The API's entire relationship with the research agent.
 *
 * Two services and two verbs: *this happened*, and *is anything outstanding*.
 * What replaced `EnrichmentModule` is smaller than the module docstring it
 * replaced, which is the point — there is no vendor client here, and nothing
 * that knows what a LinkedIn profile is. Writing a row saying a company was
 * created and counting the rows not yet done are both filing.
 */
@Module({
	providers: [AgentTriggerService, AgentQueueService],
	exports: [AgentTriggerService, AgentQueueService],
})
export class AgentModule {}
