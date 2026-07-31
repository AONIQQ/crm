import "server-only";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import {
	createTRPCOptionsProxy,
	type TRPCOptionsProxy,
} from "@trpc/tanstack-react-query";
import type { AppRouter } from "api/app-router";
import { cookies } from "next/headers";
import { cache } from "react";
import { API_URL } from "@/lib/env";
import { makeQueryClient } from "./query-client";

/**
 * The query client a server render prefetches into and then dehydrates.
 * `cache` keeps it to one per request, so several `prefetchQuery` calls across
 * a page land in the same store.
 */
export const getServerQueryClient = cache(makeQueryClient);

/**
 * tRPC for server components. Goes straight to the API rather than through the
 * app's own proxy route — there is no browser in the loop, so there is no
 * same-origin problem to solve, and one fewer hop.
 */
export function getServerTrpc(): TRPCOptionsProxy<AppRouter> {
	const client = createTRPCClient<AppRouter>({
		links: [
			httpBatchLink({
				url: `${API_URL}/api/trpc`,
				headers: async () => {
					// Forward the incoming session cookie so the API's AuthMiddleware
					// resolves the same user this render is for.
					const cookie = (await cookies()).toString();
					return cookie ? { cookie } : {};
				},
			}),
		],
	});

	return createTRPCOptionsProxy<AppRouter>({
		client,
		queryClient: getServerQueryClient,
	});
}
