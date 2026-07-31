"use client";

import { ToggleGroup, ToggleGroupItem } from "@crm/ui/components/toggle-group";
import { useQueryState } from "nuqs";
import {
	OVERVIEW_SCOPES,
	type OverviewScope,
	overviewParsers,
} from "./overview-search-params";

const LABELS: Record<OverviewScope, string> = {
	me: "Me",
	everyone: "Everyone",
};

function isScope(value: string): value is OverviewScope {
	return (OVERVIEW_SCOPES as readonly string[]).includes(value);
}

/**
 * Whose numbers the overview shows.
 *
 * In the URL rather than in state: "how the team closed this quarter" is then a
 * link someone can send, and the panel below reads the same key without either
 * side owning the other.
 */
export function OverviewScopeToggle() {
	const [scope, setScope] = useQueryState("scope", overviewParsers.scope);

	return (
		<ToggleGroup
			type="single"
			variant="outline"
			size="sm"
			spacing={0}
			value={scope}
			onValueChange={(next) => {
				// Radix clears the value when the active item is pressed again, and a
				// dashboard scoped to nobody is not a state worth having.
				if (isScope(next)) void setScope(next);
			}}
			aria-label="Whose numbers to show"
		>
			{OVERVIEW_SCOPES.map((value) => (
				<ToggleGroupItem key={value} value={value}>
					{LABELS[value]}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}
