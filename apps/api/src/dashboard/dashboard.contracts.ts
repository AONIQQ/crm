import { z } from "zod";

/**
 * Whose numbers the overview shows.
 *
 * `"me"` is the default because the page answers "how am I doing" first — a rep
 * opening the app wants their own quarter, not the team's. `"everyone"` is the
 * same page over every owner, which is what a founder or a manager wants.
 */
const DASHBOARD_SCOPES = ["me", "everyone"] as const;

export const dashboardSummaryInput = z.object({
	scope: z.enum(DASHBOARD_SCOPES).default("me"),
});

export type DashboardSummaryInput = z.infer<typeof dashboardSummaryInput>;
