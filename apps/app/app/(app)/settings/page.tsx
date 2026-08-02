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
import { AgentModel } from "./agent-model";
import { GoogleConnection } from "./google-connection";

export const metadata: Metadata = {
	title: "Settings",
};

export default async function SettingsPage() {
	await requireSession();

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();

	await Promise.all([
		queryClient.prefetchQuery(trpc.google.status.queryOptions()),
		queryClient.prefetchQuery(trpc.settings.agentModel.queryOptions()),
	]);

	void queryClient.prefetchQuery(trpc.settings.modelCatalog.queryOptions());

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
					<div className="flex max-w-3xl flex-col gap-6">
						<GoogleConnection />
						<AgentModel />
					</div>
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
