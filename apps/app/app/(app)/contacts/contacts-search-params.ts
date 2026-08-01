import { createListSearchParams } from "@/components/data-table/list-search-params";

export const contactsSearchParams = createListSearchParams({
	// Newest first: a CRM list is read to see what has changed, not to look
	// something up alphabetically — that is what ⌘K is for.
	defaultSort: "createdAt",
	defaultDir: "desc",
	facetIds: ["owner", "company"] as const,
});
