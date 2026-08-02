import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { getSession } from "@/lib/session";
import { GoogleSignIn } from "./google-sign-in";

export const metadata: Metadata = {
	title: "Sign in",
};

export default async function SignInPage() {
	const session = await getSession().catch((error: unknown) => {
		console.error("Sign-in: could not read the session.", error);
		return null;
	});

	if (session) {
		redirect("/");
	}

	return (
		<AuthShell>
			<AuthHeading
				title="Welcome back"
				description="Sign in with your Comp AI Google account to continue."
			/>

			<GoogleSignIn />

			<p className="text-center text-muted-foreground text-sm/5">
				Comp AI CRM is internal. If you cannot get in, ask an admin to check
				your Google account.
			</p>
		</AuthShell>
	);
}
