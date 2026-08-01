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
import { GoogleConnection } from "./google-connection";

export const metadata: Metadata = {
	title: "Settings",
};

export default async function SettingsPage() {
	await requireSession();

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();

	// Awaited: the whole page is this one query, and rendering "Not connected"
	// for a beat before flipping to "Connected" is worse than waiting for it.
	await queryClient.prefetchQuery(trpc.google.status.queryOptions());

	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Settings</PageShellTitle>
					<PageShellDescription>
						Your meetings and email, on the companies they belong to.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent>
				<HydrateClient>
					<GoogleConnection />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
