import { parseAsStringLiteral } from "nuqs/server";

/**
 * The timeline's filter, in the URL like every other view state here: "the
 * Attio deal, on Activity, showing what's outstanding" is then a link you can
 * send someone, and it survives a refresh.
 *
 * What makes that safe is `replace`, nuqs's default: flicking between Upcoming
 * and Done is reading, not navigating, so it rewrites the current history entry
 * instead of stacking four of them in front of the Back button that closes the
 * sheet. Same call `tab` and `add` make in `record-stack.ts`.
 *
 * Imported from `nuqs/server` for the same reason the list parsers are —
 * parsers are plain data, and nothing here should drag a client-only module
 * into a server component that wants to read the same key.
 */
/**
 * `email` and `meetings` cover what a rep logged by hand *and* what the Google
 * sync projected. Splitting those apart would turn "have we spoken to them?"
 * into two questions with two answers.
 */
export const TIMELINE_TABS = [
	"all",
	"notes",
	"email",
	"meetings",
	"upcoming",
	"done",
] as const;

export type TimelineTab = (typeof TIMELINE_TABS)[number];

/**
 * The URL key, shared with `record-stack.ts`, which clears it when you leave
 * the Activity panel or move to another record — the filter describes one
 * record's timeline, and a `?timeline=done` still hanging off the URL two
 * records later is either a lie or a surprise.
 */
export const TIMELINE_PARAM = "timeline";

/**
 * A literal parser rather than a plain string one, so a hand-edited
 * `?timeline=whatever` falls back to All instead of asking the API to filter
 * by a value it has never heard of. `all` is the default, and therefore the
 * absence of the param.
 */
export const timelineTabParser =
	parseAsStringLiteral(TIMELINE_TABS).withDefault("all");

/** The API filter a tab maps to. `all` splits into pinned + history. */
export function historyFilter(tab: TimelineTab) {
	return tab === "all" ? ("history" as const) : tab;
}
