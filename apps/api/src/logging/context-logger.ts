import { inspect } from "node:util";
import {
	ConsoleLogger,
	type ConsoleLoggerOptions,
	Injectable,
	type LogLevel,
} from "@nestjs/common";
import { getRequestContext } from "./request-context";

const PRODUCTION_LEVELS: LogLevel[] = ["fatal", "error", "warn", "log"];
const DEVELOPMENT_LEVELS: LogLevel[] = [
	"fatal",
	"error",
	"warn",
	"log",
	"debug",
	"verbose",
];

/**
 * Format and level follow `NODE_ENV` rather than having env vars of their own:
 * JSON at `log` and above in production, colourised with `debug`/`verbose`
 * locally. Read live, not captured at import, so tests can flip it.
 */
export function consoleLoggerOptions(): ConsoleLoggerOptions {
	const isProduction = process.env.NODE_ENV === "production";

	return {
		json: isProduction,
		colors: !isProduction,
		timestamp: !isProduction,
		logLevels: isProduction ? PRODUCTION_LEVELS : DEVELOPMENT_LEVELS,
	};
}

/**
 * A log line with fields attached: `logger.log({ message: "Cache miss", userId })`.
 *
 * Nest treats extra arguments as separate messages and prints one line each, so
 * structured data has to arrive as a single object rather than a second
 * argument. Fields are hoisted to the top level in JSON and rendered after the
 * text in development.
 */
export type StructuredMessage = { message: string } & Record<string, unknown>;

/** What `ConsoleLogger` emits in JSON mode, plus our correlation fields. */
interface JsonLogRecord {
	level: LogLevel;
	pid: number;
	timestamp: number;
	message: unknown;
	context?: string;
	stack?: unknown;
	requestId?: string;
	userId?: string;
}

/**
 * The application logger: `ConsoleLogger` with the current request stitched in,
 * so a line logged deep inside a service can still be traced back to the call
 * that caused it.
 *
 * Singleton, not request-scoped — the request data comes from
 * `AsyncLocalStorage`, so there is no reason to pay for a logger instance, and
 * a fresh dependency graph, per request.
 */
@Injectable()
export class ContextLogger extends ConsoleLogger {
	constructor() {
		super(consoleLoggerOptions());
	}

	protected override getJsonLogObject(
		message: unknown,
		options: {
			context: string;
			logLevel: LogLevel;
			writeStreamType?: "stdout" | "stderr";
			errorStack?: unknown;
		},
	): JsonLogRecord {
		const base = super.getJsonLogObject(message, options);
		const request = getRequestContext();

		// Base keys win over caller-supplied fields: a stray `level` in a log
		// payload must not be able to relabel the line.
		const record: JsonLogRecord = isStructuredMessage(message)
			? { ...withoutMessage(message), ...base, message: message.message }
			: base;

		if (!request) {
			return record;
		}

		return {
			...record,
			requestId: request.requestId,
			...(request.userId ? { userId: request.userId } : {}),
		};
	}

	/** Renders `{ message, ...fields }` as `text { fields }` instead of Nest's `Object(n) {…}`. */
	protected override stringifyMessage(
		message: unknown,
		logLevel: LogLevel,
	): string {
		if (!isStructuredMessage(message)) {
			return super.stringifyMessage(message, logLevel);
		}

		const fields = withoutMessage(message);
		const text = this.colorize(message.message, logLevel);

		return Object.keys(fields).length === 0
			? text
			: `${text} ${inspect(fields, this.inspectOptions)}`;
	}

	/**
	 * The pretty path has no field to put a request id in, so it rides along
	 * inside the context bracket: `[AuthService 3f9c1a2b]`.
	 */
	protected override formatContext(context: string): string {
		const request = getRequestContext();

		if (!context || !request) {
			return super.formatContext(context);
		}

		return super.formatContext(`${context} ${shortId(request.requestId)}`);
	}
}

/** Enough of a UUID to eyeball-match lines in a local terminal. */
export function shortId(requestId: string): string {
	return requestId.slice(0, 8);
}

function isStructuredMessage(value: unknown): value is StructuredMessage {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}

	const prototype = Object.getPrototypeOf(value);

	return (
		(prototype === Object.prototype || prototype === null) &&
		typeof (value as { message?: unknown }).message === "string"
	);
}

function withoutMessage(value: StructuredMessage): Record<string, unknown> {
	const { message: _message, ...fields } = value;

	return fields;
}
