"use client";

import ChartColumn from "@carbon/icons-react/es/ChartColumn";
import ListChecked from "@carbon/icons-react/es/ListChecked";
import { Icon } from "@crm/ui/components/icon";
import { ToggleGroup, ToggleGroupItem } from "@crm/ui/components/toggle-group";
import { useQueryState } from "nuqs";
import { DealsBoard } from "./deals-board";
import { dealsViewParser } from "./deals-search-params";
import { DealsTable } from "./deals-table";

/** Table or board, from `?view=` — so "the board, filtered to me" is a link. */
export function DealsViewToggle() {
	const [view, setView] = useQueryState("view", dealsViewParser);

	return (
		<ToggleGroup
			type="single"
			value={view}
			onValueChange={(next) =>
				next && setView(next === "board" ? "board" : null)
			}
			variant="outline"
			size="sm"
		>
			<ToggleGroupItem value="table" aria-label="Table">
				<Icon icon={ListChecked} />
				Table
			</ToggleGroupItem>
			<ToggleGroupItem value="board" aria-label="Board">
				<Icon icon={ChartColumn} />
				Board
			</ToggleGroupItem>
		</ToggleGroup>
	);
}

export function DealsView() {
	const [view] = useQueryState("view", dealsViewParser);

	return view === "board" ? <DealsBoard /> : <DealsTable />;
}
