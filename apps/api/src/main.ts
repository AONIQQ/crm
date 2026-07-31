import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { ContextLogger } from "./logging/context-logger";

async function bootstrap() {
	const logger = new ContextLogger();

	const app = await NestFactory.create(AppModule, {
		bodyParser: false,
		logger,
	});

	app.use(helmet());
	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			forbidNonWhitelisted: true,
			transform: true,
			transformOptions: { enableImplicitConversion: true },
		}),
	);
	app.enableShutdownHooks();

	const port = process.env.PORT ?? 3001;
	await app.listen(port);

	new Logger("Bootstrap").log({
		message: `API listening on http://localhost:${port}`,
		port: Number(port),
		environment: process.env.NODE_ENV ?? "development",
	});
}

void bootstrap().catch((error: unknown) => {
	new Logger("Bootstrap").fatal(
		{ message: "API failed to start" },
		error instanceof Error ? error.stack : String(error),
	);
	process.exit(1);
});
