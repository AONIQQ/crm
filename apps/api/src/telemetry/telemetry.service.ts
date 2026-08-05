import {
	flushTelemetry,
	onTelemetryProblem,
	shutdownTelemetry,
	syncVersion,
	telemetryDisabled,
} from "@crm/telemetry";
import {
	Injectable,
	Logger,
	type OnApplicationShutdown,
	type OnModuleInit,
} from "@nestjs/common";
import { FunnelService } from "./funnel.service";

@Injectable()
export class TelemetryService implements OnModuleInit, OnApplicationShutdown {
	private readonly logger = new Logger(TelemetryService.name);

	constructor(private readonly funnel: FunnelService) {}

	async onModuleInit(): Promise<void> {
		onTelemetryProblem((message) => this.logger.debug({ message }));

		if (telemetryDisabled()) {
			this.logger.log({
				message: "Anonymous usage telemetry is off for this install.",
			});
			return;
		}

		const install = await syncVersion();

		this.logger.log({
			message: "Anonymous usage telemetry is on. See docs/telemetry.md.",
			crmVersion: install?.version,
		});

		void this.funnel.sweep().catch(() => {});
	}

	async onApplicationShutdown(): Promise<void> {
		await flushTelemetry();
		await shutdownTelemetry();
	}
}
