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
import { boardInput } from "./deals.board";
import {
	dealCreateInput,
	dealIdInput,
	dealListInput,
	dealUpdateArgs,
	setContactsInput,
	setStageInput,
} from "./deals.contracts";
import { DealsService } from "./deals.service";

@Router({ alias: "deals" })
@UseMiddlewares(AuthMiddleware)
export class DealsRouter {
	constructor(@Inject(DealsService) private readonly deals: DealsService) {}

	@Query({ input: dealListInput })
	async list(@Input() input: z.infer<typeof dealListInput>) {
		return this.deals.list(input);
	}

	/** The open pipeline as stage columns, for `?view=board`. */
	@Query({ input: boardInput })
	async board(@Input() input: z.infer<typeof boardInput>) {
		return this.deals.board(input);
	}

	@Query({ input: dealIdInput })
	async byId(@Input("id") id: string) {
		return this.deals.byId(id);
	}

	@Mutation({ input: dealCreateInput })
	async create(@Input() input: z.infer<typeof dealCreateInput>) {
		return this.deals.create(input);
	}

	@Mutation({ input: dealUpdateArgs })
	async update(@Input() input: z.infer<typeof dealUpdateArgs>) {
		return this.deals.update(input.id, input.data);
	}

	/** Moves the deal and writes the `STAGE_CHANGE` activity in one transaction. */
	@Mutation({ input: setStageInput })
	async setStage(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof setStageInput>,
	) {
		return this.deals.setStage(input, ctx.user.id);
	}

	@Mutation({ input: setContactsInput })
	async setContacts(@Input() input: z.infer<typeof setContactsInput>) {
		return this.deals.setContacts(input);
	}

	@Mutation({ input: dealIdInput })
	async remove(@Input("id") id: string) {
		return this.deals.remove(id);
	}
}
