import {
	type CallHandler,
	type ExecutionContext,
	Injectable,
	type NestInterceptor,
} from "@nestjs/common";
import type { Request } from "express";
import type { Observable } from "rxjs";
import { setRequestUserId } from "./request-context";

/**
 * Copies the authenticated user id into the request context once the auth guard
 * has resolved the session, so logs written by handlers and services carry it.
 *
 * Interceptors run after guards, which is the earliest point where
 * `request.session` is populated by `@thallesp/nestjs-better-auth`.
 */
@Injectable()
export class UserContextInterceptor implements NestInterceptor {
	intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
		if (context.getType() !== "http") {
			return next.handle();
		}

		const request = context
			.switchToHttp()
			.getRequest<Request & { session?: { user?: { id?: string } } }>();
		const userId = request.session?.user?.id;

		if (userId) {
			setRequestUserId(userId);
		}

		return next.handle();
	}
}
