import "server-only";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { getServerQueryClient } from "./server";

/**
 * Ships everything the page prefetched to the browser, so the client component
 * inside renders with data instead of a spinner.
 *
 * Must be rendered after the `prefetchQuery` calls it is meant to carry —
 * `dehydrate` is a snapshot, not a subscription.
 */
export function HydrateClient({ children }: { children: ReactNode }) {
	return (
		<HydrationBoundary state={dehydrate(getServerQueryClient())}>
			{children}
		</HydrationBoundary>
	);
}
