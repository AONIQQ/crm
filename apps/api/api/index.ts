import "reflect-metadata";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "../src/create-app";

type ExpressInstance = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * The serverless entrypoint.
 *
 * Nest is built once per instance and reused: `instancePromise` is module
 * scope, so a warm invocation skips the whole `NestFactory.create` — module
 * resolution, the Prisma connection, route mapping — and only runs the
 * request. Storing the promise rather than the app also means two requests
 * arriving during a cold start share one boot instead of racing two.
 *
 * `app.init()` and not `app.listen()`: there is no port to bind here. Vercel
 * hands us `(req, res)` and Express takes it from there.
 */
let instancePromise: Promise<ExpressInstance> | null = null;

function getInstance(): Promise<ExpressInstance> {
	if (!instancePromise) {
		instancePromise = (async () => {
			const app = await createApp();
			await app.init();
			return app.getHttpAdapter().getInstance() as ExpressInstance;
		})();
	}
	return instancePromise;
}

export default async function handler(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const instance = await getInstance();
	instance(req, res);
}
