import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import type {
	MiddlewareOptions,
	MiddlewareResponse,
	TRPCMiddleware,
} from "nestjs-trpc";
import { setRequestUserId } from "../../logging/request-context";
import type { AuthedTrpcContext, BaseTrpcContext } from "../context.types";

/**
 * Google sign-in is the only door, so "signed in" is the whole authorisation
 * model — there are no organizations, roles or permissions in this CRM.
 */
@Injectable()
export class AuthMiddleware implements TRPCMiddleware {
	async use(opts: MiddlewareOptions): Promise<MiddlewareResponse> {
		const ctx = opts.ctx as BaseTrpcContext;
		const user = ctx.session?.user;

		if (!user) {
			throw new TRPCError({ code: "UNAUTHORIZED" });
		}

		// tRPC calls arrive as one HTTP request per batch, so the interceptor that
		// stamps `userId` for REST routes never runs. Stamp it here instead.
		setRequestUserId(user.id);

		const nextCtx: AuthedTrpcContext = { ...ctx, user };
		return opts.next({ ctx: nextCtx });
	}
}
