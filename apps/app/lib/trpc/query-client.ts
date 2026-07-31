import {
	defaultShouldDehydrateQuery,
	QueryClient,
} from "@tanstack/react-query";

export function makeQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			// Long enough that a server-prefetched query is not immediately refetched
			// on hydration, short enough that a stale list corrects itself.
			queries: { staleTime: 30_000 },
			dehydrate: {
				// Ship in-flight queries too, so a page can stream a prefetch it
				// started but did not await.
				shouldDehydrateQuery: (query) =>
					defaultShouldDehydrateQuery(query) ||
					query.state.status === "pending",
			},
		},
	});
}

let browserQueryClient: QueryClient | undefined;

/**
 * One client per browser tab, a fresh one per server request — sharing a client
 * across requests would leak one user's data into another's cache.
 */
export function getQueryClient(): QueryClient {
	if (typeof window === "undefined") {
		return makeQueryClient();
	}
	browserQueryClient ??= makeQueryClient();
	return browserQueryClient;
}
