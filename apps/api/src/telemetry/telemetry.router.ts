import { Inject } from "@nestjs/common";
import { Query, Router, UseMiddlewares } from "nestjs-trpc";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { TelemetryService } from "./telemetry.service";

@Router({ alias: "telemetry" })
@UseMiddlewares(AuthMiddleware)
export class TelemetryRouter {
	constructor(
		@Inject(TelemetryService) private readonly telemetry: TelemetryService,
	) {}

	@Query()
	async status() {
		return this.telemetry.status();
	}
}
