import type { Metadata } from "next";
import type { SearchParams } from "nuqs/server";
import {
	PageShell,
	PageShellActions,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellTitle,
} from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { CreateDealSheet } from "./create-deal-sheet";
import { dealsSearchParams, loadDealsView } from "./deals-search-params";
import { DealsView, DealsViewToggle } from "./deals-view";

export const metadata: Metadata = {
	title: "Deals",
};

export default async function DealsPage({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	await requireSession();

	const values = await dealsSearchParams.load(searchParams);
	const view = loadDealsView(await searchParams);

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	// The rows are awaited so the first paint is the filtered, sorted, correct
	// page rather than a spinner. The owner and company pickers behind the facet
	// dropdowns are not — the table draws fine without them.
	// Only the view actually being shown is prefetched — the other one is a
	// second set of queries nobody asked for.
	await (view === "board"
		? queryClient.prefetchQuery(
				trpc.deals.board.queryOptions({
					q: values.q.trim(),
					owner: values.owner,
					limit: 50,
				}),
			)
		: queryClient.prefetchQuery(
				trpc.deals.list.queryOptions(dealsSearchParams.toInput(values)),
			));
	void queryClient.prefetchQuery(trpc.users.list.queryOptions());
	void queryClient.prefetchQuery(
		trpc.companies.options.queryOptions({ q: "" }),
	);

	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Deals</PageShellTitle>
					<PageShellDescription>
						The pipeline, and everything that has already closed.
					</PageShellDescription>
				</PageShellHeading>
				<PageShellActions>
					<DealsViewToggle />
					<CreateDealSheet />
				</PageShellActions>
			</PageShellHeader>

			<PageShellContent>
				<HydrateClient>
					<DealsView />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
