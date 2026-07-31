import { Inject } from "@nestjs/common";
import { Ctx, Query, Router, UseMiddlewares } from "nestjs-trpc";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { DashboardService } from "./dashboard.service";

@Router({ alias: "dashboard" })
@UseMiddlewares(AuthMiddleware)
export class DashboardRouter {
	constructor(
		@Inject(DashboardService) private readonly dashboard: DashboardService,
	) {}

	/** Pipeline by stage, deals closing this month, my overdue tasks, recent activity. */
	@Query()
	async summary(@Ctx() ctx: AuthedTrpcContext) {
		return this.dashboard.summary(ctx.user.id);
	}
}
