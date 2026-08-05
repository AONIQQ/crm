"use client";

import {
	POSTHOG_HOST,
	POSTHOG_KEY,
	POSTHOG_UI_HOST,
} from "@crm/telemetry/project";
import { useMountEffect } from "@crm/ui/hooks/use-mount-effect";
import { analyticsAllowed } from "@/lib/analytics";

export function LandingAnalytics() {
	useMountEffect(() => {
		if (!analyticsAllowed(window.location.hostname)) return;

		import("posthog-js")
			.then(({ default: posthog }) => {
				posthog.init(POSTHOG_KEY, {
					api_host: POSTHOG_HOST,
					ui_host: POSTHOG_UI_HOST,
					defaults: "2026-06-25",
				});
			})
			.catch(() => {});
	});

	return null;
}
