import { randomUUID } from "node:crypto";
import { Injectable, Logger, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { type RequestContext, runInRequestContext } from "./request-context";

const REQUEST_ID_HEADER = "x-request-id";

/** Liveness probes are the loudest thing in the log and the least interesting. */
const QUIET_PATHS = new Set(["/health"]);

/**
 * Opens the request context and writes one access line per request.
 *
 * Deliberately logs no headers, query string or body: this is a CRM, and all
 * three routinely carry credentials and personal data. Anything worth logging
 * from a payload should be logged explicitly by the handler that understands it.
 */
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
	private readonly logger = new Logger("HTTP");

	use(request: Request, response: Response, next: NextFunction): void {
		const requestId = incomingRequestId(request) ?? randomUUID();
		response.setHeader(REQUEST_ID_HEADER, requestId);

		const context: RequestContext = {
			requestId,
			method: request.method,
			path: request.originalUrl,
		};
		const startedAt = process.hrtime.bigint();

		runInRequestContext(context, () => {
			response.on("finish", () => {
				// `finish` is emitted from the socket's async context rather than
				// ours, so the context is re-entered explicitly, not inherited.
				runInRequestContext(context, () => {
					this.logCompleted(request, response, context, startedAt);
				});
			});

			next();
		});
	}

	private logCompleted(
		request: Request,
		response: Response,
		context: RequestContext,
		startedAt: bigint,
	): void {
		const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
		const { statusCode } = response;

		// The auth guard resolves the session long after the context is opened,
		// so this is the first point at which the user is reliably known.
		const userId = sessionUserId(request);

		if (userId) {
			context.userId = userId;
		}

		const payload = {
			message: `${context.method} ${context.path} ${statusCode} ${durationMs.toFixed(1)}ms`,
			method: context.method,
			path: context.path,
			statusCode,
			durationMs: Number(durationMs.toFixed(1)),
			ip: request.ip,
			userAgent: request.get("user-agent"),
		};

		if (statusCode >= 500) {
			this.logger.error(payload);
			return;
		}

		if (statusCode >= 400) {
			this.logger.warn(payload);
			return;
		}

		if (QUIET_PATHS.has(request.path)) {
			this.logger.verbose(payload);
			return;
		}

		this.logger.log(payload);
	}
}

/**
 * A proxy or upstream service may already have stamped the request; reusing its
 * id is what makes a trace span more than one hop.
 */
function incomingRequestId(request: Request): string | undefined {
	const header = request.get(REQUEST_ID_HEADER);

	// Untrusted input that ends up in every log line for this request, so it is
	// length-capped and stripped of anything that could forge a second field.
	if (!header || header.length > 200 || !/^[\w.:-]+$/.test(header)) {
		return undefined;
	}

	return header;
}

const sharedInstance = new RequestLoggerMiddleware();

/**
 * Better Auth mounts its handler directly onto the HTTP adapter while its
 * module is being configured — before Nest applies anything registered through
 * `MiddlewareConsumer` — so `/api/auth/*` terminates before the class above
 * ever runs. Its `middleware` option is the supported way in, and it is only
 * invoked for requests Better Auth itself will handle, so nothing is logged
 * twice.
 */
export function logAuthRoute(
	request: Request,
	response: Response,
	next: NextFunction,
): void {
	sharedInstance.use(request, response, next);
}

function sessionUserId(request: Request): string | undefined {
	const { session } = request as Request & {
		session?: { user?: { id?: string } };
	};

	return session?.user?.id;
}
