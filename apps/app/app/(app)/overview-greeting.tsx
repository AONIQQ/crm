"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { PageShellDescription, PageShellTitle } from "@/components/page-shell";
import { useTRPC } from "@/lib/trpc/client";
import { overviewParsers } from "./overview-search-params";

/**
 * Reads the signed-in user from the API rather than the session cookie, so a
 * renamed account is right on the next load instead of the next sign-in.
 *
 * `useSuspenseQuery` because the page awaits the prefetch: the data is already
 * in the cache by the time this renders, and the alternative is an
 * `undefined` branch that can never actually be taken.
 */
export function OverviewGreeting() {
	const trpc = useTRPC();
	const { data: me } = useSuspenseQuery(trpc.users.me.queryOptions());
	const [scope] = useQueryState("scope", overviewParsers.scope);

	return (
		<>
			<PageShellTitle>Welcome back, {me.name.split(" ")[0]}</PageShellTitle>
			<PageShellDescription>
				{scope === "me"
					? "What you have closed, what is still in play, and what needs you today."
					: "What the team has closed, what is still in play, and what needs you today."}
			</PageShellDescription>
		</>
	);
}
