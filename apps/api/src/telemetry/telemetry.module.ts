import { Module } from "@nestjs/common";
import { TrpcModule } from "../trpc/trpc.module";
import { FunnelService } from "./funnel.service";
import { RollupService } from "./rollup.service";
import { TelemetryController } from "./telemetry.controller";
import { TelemetryRouter } from "./telemetry.router";
import { TelemetryService } from "./telemetry.service";

@Module({
	imports: [TrpcModule],
	controllers: [TelemetryController],
	providers: [FunnelService, RollupService, TelemetryService, TelemetryRouter],
	exports: [TelemetryService],
})
export class TelemetryModule {}
