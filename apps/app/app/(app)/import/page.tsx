import type { Metadata } from "next";
import {
	PageShell,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellTitle,
} from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { ImportPanel } from "./import-panel";

export const metadata: Metadata = {
	title: "Import",
};

export default async function ImportPage() {
	await requireSession();

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	void queryClient.prefetchQuery(trpc.users.list.queryOptions());

	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Import from HubSpot</PageShellTitle>
					<PageShellDescription>
						Export a list from HubSpot and drop the CSV here. Companies match on
						domain and contacts on email, so re-running an import updates rather
						than duplicates.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent>
				<HydrateClient>
					<ImportPanel />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
