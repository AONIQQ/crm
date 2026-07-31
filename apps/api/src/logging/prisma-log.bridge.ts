import { setPrismaLogSink } from "@crm/db";
import {
	Injectable,
	Logger,
	type OnApplicationShutdown,
	type OnModuleInit,
} from "@nestjs/common";

/**
 * Routes Prisma engine logs through the application logger, so a database
 * warning is formatted like everything else and carries the request that
 * triggered it.
 */
@Injectable()
export class PrismaLogBridge implements OnModuleInit, OnApplicationShutdown {
	private readonly logger = new Logger("Prisma");

	onModuleInit(): void {
		setPrismaLogSink(({ level, message, target, durationMs }) => {
			const payload = {
				message,
				target,
				...(durationMs === undefined ? {} : { durationMs }),
			};

			if (level === "error") {
				this.logger.error(payload);
				return;
			}

			if (level === "warn") {
				this.logger.warn(payload);
				return;
			}

			// `query` and `info` only fire when PRISMA_LOG_QUERIES is set, and are
			// debug-level so they stay out of production logs even then.
			this.logger.debug(payload);
		});
	}

	onApplicationShutdown(): void {
		// The Prisma client outlives the Nest app during a hot reload; leaving a
		// sink pointing at a torn-down logger would log into nothing.
		setPrismaLogSink(null);
	}
}
