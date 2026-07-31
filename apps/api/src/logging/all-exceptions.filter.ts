import {
	type ArgumentsHost,
	Catch,
	type ExceptionFilter,
	HttpException,
	HttpStatus,
	Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { getRequestContext } from "./request-context";

/**
 * Logs every exception with its request context and returns a consistent body.
 *
 * Nest's built-in filter logs unhandled errors, but without the request id —
 * which is the one field that makes a production stack trace actionable. The
 * response shape is left alone apart from `requestId`, so an operator can quote
 * the id from a failed call and land on the exact log line.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
	private readonly logger = new Logger("ExceptionsHandler");

	catch(exception: unknown, host: ArgumentsHost): void {
		if (host.getType() !== "http") {
			throw exception;
		}

		const http = host.switchToHttp();
		const request = http.getRequest<Request>();
		const response = http.getResponse<Response>();

		const status =
			exception instanceof HttpException
				? exception.getStatus()
				: HttpStatus.INTERNAL_SERVER_ERROR;
		const requestId = getRequestContext()?.requestId;

		this.log(exception, status, request);

		// A streamed or already-committed response can only be logged, not
		// rewritten.
		if (response.headersSent) {
			return;
		}

		response.status(status).json(body(exception, status, requestId));
	}

	private log(exception: unknown, status: number, request: Request): void {
		const payload = {
			message: describe(exception),
			method: request.method,
			path: request.originalUrl,
			statusCode: status,
			exception: exception?.constructor?.name,
		};

		if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
			this.logger.error(
				payload,
				exception instanceof Error ? exception.stack : undefined,
			);
			return;
		}

		// The access log already records 4xx as a warning; this adds the reason
		// for anyone who turns debug on, without doubling up in production.
		this.logger.debug(payload);
	}
}

function describe(exception: unknown): string {
	if (exception instanceof Error) {
		return exception.message;
	}

	return typeof exception === "string" ? exception : "Unknown exception";
}

function body(
	exception: unknown,
	status: number,
	requestId: string | undefined,
): Record<string, unknown> {
	const withRequestId = requestId ? { requestId } : {};

	if (!(exception instanceof HttpException)) {
		// Never let an unexpected error's message reach the client: it is the
		// classic way internals leak. The log has the detail.
		return {
			statusCode: status,
			message: "Internal server error",
			...withRequestId,
		};
	}

	const original = exception.getResponse();

	if (typeof original === "string") {
		return { statusCode: status, message: original, ...withRequestId };
	}

	return { ...(original as Record<string, unknown>), ...withRequestId };
}
