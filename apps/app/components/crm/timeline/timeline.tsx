"use client";

import { Button } from "@crm/ui/components/button";
import { Spinner } from "@crm/ui/components/spinner";
import { ToggleGroup, ToggleGroupItem } from "@crm/ui/components/toggle-group";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTRPC } from "@/lib/trpc/client";
import { ActivityComposer } from "./activity-composer";
import { TimelineEntry, type TimelineEntryData } from "./timeline-entry";
import {
	historyFilter,
	TIMELINE_TABS,
	type TimelineTab,
} from "./timeline-search-params";

/** Exactly one of these — a timeline is always about one record. */
export type TimelineAnchor =
	| { companyId: string }
	| { contactId: string }
	| { dealId: string };

const TAB_LABELS: Record<TimelineTab, string> = {
	all: "All",
	notes: "Notes",
	upcoming: "Upcoming",
	done: "Done",
};

const dayFormat = new Intl.DateTimeFormat(undefined, {
	weekday: "long",
	month: "long",
	day: "numeric",
	year: "numeric",
});

/** Groups entries by calendar day, preserving the order they arrived in. */
function byDay(entries: TimelineEntryData[]) {
	const groups: { day: string; label: string; entries: TimelineEntryData[] }[] =
		[];

	for (const entry of entries) {
		const at = new Date(entry.occurredAt ?? entry.createdAt);
		const day = at.toDateString();
		const last = groups[groups.length - 1];
		if (last?.day === day) {
			last.entries.push(entry);
		} else {
			groups.push({ day, label: dayFormat.format(at), entries: [entry] });
		}
	}

	return groups;
}

/**
 * Everything that has happened to a record, and the box for adding to it.
 *
 * Built as a panel that fills its tab: the composer stays put at the top,
 * where a rep can log the call they just finished without scrolling past a
 * year of history to reach it.
 *
 * A company's timeline picks up its deals' and contacts' entries for free —
 * the API stamps `companyId` on every activity it can resolve one for, so this
 * is one indexed range scan rather than three joins.
 */
export function Timeline({ anchor }: { anchor: TimelineAnchor }) {
	const trpc = useTRPC();

	const [tab, setTab] = useState<TimelineTab>("all");

	const counts = useQuery(trpc.activities.timelineCounts.queryOptions(anchor));

	// On the "All" tab, outstanding tasks are pinned above the history and the
	// history excludes them, so nothing appears twice.
	const pinned = useQuery({
		...trpc.activities.timeline.queryOptions({
			...anchor,
			filter: "upcoming",
			limit: 10,
		}),
		enabled: tab === "all",
	});

	const history = useInfiniteQuery({
		...trpc.activities.timeline.infiniteQueryOptions(
			{ ...anchor, filter: historyFilter(tab) },
			{ getNextPageParam: (page) => page.nextCursor ?? undefined },
		),
	});

	const entries = history.data?.pages.flatMap((page) => page.entries) ?? [];
	const pinnedEntries = tab === "all" ? (pinned.data?.entries ?? []) : [];

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="shrink-0 border-b p-5">
				<ActivityComposer anchor={anchor} />
			</div>

			<div className="flex shrink-0 items-center border-b px-5 py-2">
				<ToggleGroup
					type="single"
					value={tab}
					onValueChange={(next) => next && setTab(next as TimelineTab)}
					variant="outline"
					size="sm"
				>
					{TIMELINE_TABS.map((option) => (
						<ToggleGroupItem key={option} value={option}>
							{TAB_LABELS[option]}
							{counts.data ? (
								<span className="tabular-nums opacity-60">
									{counts.data[option]}
								</span>
							) : null}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			</div>

			<div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
				{pinnedEntries.length > 0 ? (
					<section>
						<h3 className="pb-1 font-medium text-muted-foreground text-xs">
							Outstanding
						</h3>
						<ul className="divide-y">
							{pinnedEntries.map((entry) => (
								<TimelineEntry key={entry.id} entry={entry} />
							))}
						</ul>
					</section>
				) : null}

				{history.isPending ? (
					<div className="flex justify-center py-6">
						<Spinner />
					</div>
				) : entries.length === 0 && pinnedEntries.length === 0 ? (
					<p className="py-10 text-center text-muted-foreground text-xs">
						Nothing here yet.
					</p>
				) : (
					byDay(entries).map((group) => (
						<section key={group.day}>
							<h3 className="pb-1 font-medium text-muted-foreground text-xs">
								{group.label}
							</h3>
							<ul className="divide-y">
								{group.entries.map((entry) => (
									<TimelineEntry key={entry.id} entry={entry} />
								))}
							</ul>
						</section>
					))
				)}

				{history.hasNextPage ? (
					<Button
						variant="outline"
						size="sm"
						className="self-start"
						disabled={history.isFetchingNextPage}
						onClick={() => history.fetchNextPage()}
					>
						{history.isFetchingNextPage ? <Spinner /> : null}
						Show older
					</Button>
				) : null}
			</div>
		</div>
	);
}
