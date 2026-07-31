import { parseAsStringLiteral } from "nuqs/server";
import { createListSearchParams } from "@/components/data-table/list-search-params";

export const dealsSearchParams = createListSearchParams({
	// Pipeline order by default: the deals closest to closing are the ones a rep
	// opens this page to look at.
	defaultSort: "stage",
	tabId: "status",
	facetIds: ["owner", "stage", "closing"] as const,
});

/** `?view=board` swaps the table for the pipeline columns. */
export const dealsViewParser = parseAsStringLiteral([
	"table",
	"board",
] as const).withDefault("table");

export const loadDealsView = (searchParams: Record<string, unknown>) =>
	dealsViewParser.parseServerSide(
		searchParams.view as string | string[] | undefined,
	);
