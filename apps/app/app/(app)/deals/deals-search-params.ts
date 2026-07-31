import { createListSearchParams } from "@/components/data-table/list-search-params";

export const dealsSearchParams = createListSearchParams({
	// Pipeline order by default: the deals closest to closing are the ones a rep
	// opens this page to look at.
	defaultSort: "stage",
	tabId: "status",
	facetIds: ["owner", "stage", "closing"] as const,
});
