import { createListSearchParams } from "@/components/data-table/list-search-params";

export const contactsSearchParams = createListSearchParams({
	defaultSort: "name",
	facetIds: ["owner", "company"] as const,
});
