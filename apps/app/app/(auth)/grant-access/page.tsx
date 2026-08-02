import { hasSyncScopes } from "@crm/auth";
import { db } from "@crm/db";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { requireSession } from "@/lib/session";
import { GrantAccess } from "./grant-access";

export const metadata: Metadata = {
	title: "Grant access",
};

export default async function GrantAccessPage() {
	const { user } = await requireSession();

	const account = await db.account.findFirst({
		where: { userId: user.id, providerId: "google" },
		select: { scope: true },
	});

	if (hasSyncScopes(account?.scope)) {
		redirect("/");
	}

	return (
		<AuthShell>
			<AuthHeading
				title="One more step"
				description="Comp AI CRM reads your Gmail and Calendar so meetings and email threads show up on the right company. It is read-only — nothing is ever sent on your behalf."
			/>

			<GrantAccess />

			<p className="text-center text-muted-foreground text-sm/5">
				Only conversations with companies in the CRM are stored. Personal mail
				is discarded without being saved.
			</p>
		</AuthShell>
	);
}
