"use client";

import { authClient, signOut } from "@crm/auth/client";
import { SYNC_SCOPES } from "@crm/auth/scopes";
import GoogleLogo from "@crm/ui/components/brand-logos/google";
import { Button } from "@crm/ui/components/button";
import { Spinner } from "@crm/ui/components/spinner";
import { useState } from "react";
import { toast } from "sonner";

export function GrantAccess() {
	const [pending, setPending] = useState(false);

	async function handleGrant() {
		setPending(true);

		// Absolute, like the sign-in button: the API owns /api/auth/*, so a
		// relative URL would resolve against the API's origin rather than this
		// app's. Better Auth checks it against AUTH_TRUSTED_ORIGINS.
		const origin = window.location.origin;

		// `linkSocial` rather than `signIn.social`: there is already a session and
		// an account row, and this is a scope upgrade on the existing grant.
		// Google's incremental authorisation means the resulting token covers the
		// union, so sign-in keeps working either way.
		const { error } = await authClient.linkSocial({
			provider: "google",
			scopes: [...SYNC_SCOPES],
			callbackURL: `${origin}/`,
			errorCallbackURL: `${origin}/grant-access`,
		});

		// On success the browser has already navigated to Google.
		if (error) {
			toast.error(error.message ?? "Could not reach Google.");
			setPending(false);
		}
	}

	async function handleSignOut() {
		const { error } = await signOut();

		if (error) {
			toast.error(error.message ?? "Could not sign out.");
			return;
		}

		window.location.assign("/sign-in");
	}

	return (
		<div className="flex flex-col gap-3">
			<Button
				className="w-full"
				disabled={pending}
				onClick={handleGrant}
				type="button"
			>
				{pending ? (
					<Spinner data-icon="inline-start" />
				) : (
					<GoogleLogo data-icon="inline-start" className="size-4" />
				)}
				Grant access
			</Button>

			{/*
			 * Somebody who does not want to grant this needs a way out that is not
			 * the back button into a redirect loop.
			 */}
			<Button
				className="w-full"
				onClick={() => {
					handleSignOut().catch(() => toast.error("Could not sign out."));
				}}
				type="button"
				variant="ghost"
			>
				Sign out
			</Button>
		</div>
	);
}
