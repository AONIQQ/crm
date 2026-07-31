import { createListSearchParams } from "@/components/data-table/list-search-params";

/**
 * The companies list URL. Shared by the page's server-side prefetch and the
 * client table, so the two cannot ask for different things.
 */
export const companiesSearchParams = createListSearchParams({
	defaultSort: "name",
	facetIds: ["owner", "industry", "enrichment"] as const,
});
