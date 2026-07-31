/**
 * Buckets for the "closing" facet, in the order a rep would scan them.
 *
 * Kept in step with `CLOSING_WINDOWS` in `apps/api/src/deals/deals.contracts.ts`
 * — the API owns which dates fall in which bucket; this is only the labels.
 */
export const CLOSING_OPTIONS = [
	{ value: "overdue", label: "Overdue" },
	{ value: "this-month", label: "Closing this month" },
	{ value: "next-month", label: "Closing next month" },
	{ value: "later", label: "Later" },
	{ value: "none", label: "No close date" },
] as const;
