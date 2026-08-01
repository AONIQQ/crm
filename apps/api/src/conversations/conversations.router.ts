import { Inject } from "@nestjs/common";
import {
	Ctx,
	Input,
	Mutation,
	Query,
	Router,
	UseMiddlewares,
} from "nestjs-trpc";
import type { z } from "zod";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import {
	conversationEventsInput,
	conversationIdInput,
	conversationListInput,
	conversationSaveInput,
} from "./conversations.contracts";
import { ConversationsService } from "./conversations.service";

/**
 * A record's history with the agent.
 *
 * Every procedure is scoped to the signed-in user by the service, not by the
 * caller: a conversation id in a request body decides *which* row, never
 * *whose*.
 */
@Router({ alias: "conversations" })
@UseMiddlewares(AuthMiddleware)
export class ConversationsRouter {
	constructor(
		@Inject(ConversationsService)
		private readonly conversations: ConversationsService,
	) {}

	@Query({ input: conversationListInput })
	async list(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof conversationListInput>,
	) {
		return this.conversations.list(input, ctx.user.id);
	}

	/** The stored transcript, for rehydrating a reopened thread. */
	@Query({ input: conversationEventsInput })
	async events(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof conversationEventsInput>,
	) {
		return this.conversations.events(input, ctx.user.id);
	}

	@Mutation({ input: conversationSaveInput })
	async save(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof conversationSaveInput>,
	) {
		return this.conversations.save(input, ctx.user.id);
	}

	@Mutation({ input: conversationIdInput })
	async remove(@Ctx() ctx: AuthedTrpcContext, @Input("id") id: string) {
		return this.conversations.remove(id, ctx.user.id);
	}
}
