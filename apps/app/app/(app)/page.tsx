import {
	PageShell,
	PageShellContent,
	PageShellHeader,
	PageShellHeading,
} from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { DashboardSummary } from "./dashboard-summary";
import { OverviewGreeting } from "./overview-greeting";

export default async function OverviewPage() {
	await requireSession();

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	// The greeting is awaited — it is one line of text, and a skeleton that
	// flashes for the length of one API call is worse than rendering a beat
	// later. The summary streams in behind it.
	await queryClient.prefetchQuery(trpc.users.me.queryOptions());
	await queryClient.prefetchQuery(trpc.dashboard.summary.queryOptions());

	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<HydrateClient>
						<OverviewGreeting />
					</HydrateClient>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent>
				<HydrateClient>
					<DashboardSummary />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
