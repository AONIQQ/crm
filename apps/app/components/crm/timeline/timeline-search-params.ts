/**
 * The timeline's filter.
 *
 * Component state rather than a URL param: the timeline now lives inside a
 * record sheet, and the sheet's identity is already in `?record=`. Adding the
 * filter there too would mean a glance at "Upcoming" becomes a history entry
 * the back button has to walk through before it closes the sheet.
 */
export const TIMELINE_TABS = ["all", "notes", "upcoming", "done"] as const;

export type TimelineTab = (typeof TIMELINE_TABS)[number];

/** The API filter a tab maps to. `all` splits into pinned + history. */
export function historyFilter(tab: TimelineTab) {
	return tab === "all" ? ("history" as const) : tab;
}
