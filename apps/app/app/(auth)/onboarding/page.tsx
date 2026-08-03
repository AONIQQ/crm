import { DEFAULT_WORKSPACE_NAME } from "@crm/auth";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { requireGoogleAccess } from "@/lib/session";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = {
	title: "Set up",
};

export default async function OnboardingPage() {
	await requireGoogleAccess();

	const workspace = await getServerQueryClient()
		.fetchQuery(getServerTrpc().workspace.get.queryOptions())
		.catch(() => null);

	if (workspace && (workspace.onboarded || !workspace.canRename)) {
		redirect("/");
	}

	return (
		<AuthShell>
			<AuthHeading
				title="Tell us about your company"
				description="Two things, once. The name is what the CRM calls you; the website is how the agent learns what you sell."
			/>

			<OnboardingForm placeholder={workspace?.name ?? DEFAULT_WORKSPACE_NAME} />
		</AuthShell>
	);
}
