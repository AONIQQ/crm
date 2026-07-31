import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The per-request facts every log line should carry. Kept deliberately small:
 * anything larger tends to become a second, untyped request object.
 */
export interface RequestContext {
	requestId: string;
	method: string;
	path: string;
	userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Runs `fn`, and everything it awaits, with `context` attached. */
export function runInRequestContext<T>(
	context: RequestContext,
	fn: () => T,
): T {
	return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
	return storage.getStore();
}

/**
 * The user is only known once the auth guard has run, which is well after the
 * context is created — so it is filled in rather than passed in.
 */
export function setRequestUserId(userId: string): void {
	const context = storage.getStore();

	if (context) {
		context.userId = userId;
	}
}
