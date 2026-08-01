"use client";

import { signIn } from "@crm/auth/client";
import GoogleLogo from "@crm/ui/components/brand-logos/google";
import { Button } from "@crm/ui/components/button";
import { Spinner } from "@crm/ui/components/spinner";
import { useState } from "react";
import { toast } from "sonner";

export function GoogleSignIn() {
	const [pending, setPending] = useState(false);

	async function handleClick() {
		setPending(true);

		// The API owns /api/auth/*, so both URLs have to be absolute — a relative
		// one would resolve against the API's origin, not this app's. Better Auth
		// checks them against the origins in APP_URL.
		const origin = window.location.origin;

		const { error } = await signIn.social({
			provider: "google",
			callbackURL: `${origin}/`,
			errorCallbackURL: `${origin}/sign-in`,
		});

		// On success the client has already navigated to Google.
		if (error) {
			toast.error(error.message ?? "Could not reach the sign-in service.");
			setPending(false);
		}
	}

	return (
		<Button
			className="w-full"
			disabled={pending}
			onClick={handleClick}
			type="button"
			variant="outline"
		>
			{pending ? (
				<Spinner data-icon="inline-start" />
			) : (
				<GoogleLogo data-icon="inline-start" className="size-4" />
			)}
			Continue with Google
		</Button>
	);
}
