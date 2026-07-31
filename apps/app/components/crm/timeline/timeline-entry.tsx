"use client";

import { Checkbox } from "@crm/ui/components/checkbox";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { relativeTimeFromIso } from "@crm/ui/lib/format";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { dealStageLabel } from "@/components/crm/deal-stage";
import { RecordLink } from "@/components/crm/record-sheet/record-link";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { ActivityIcon, activityLabel } from "./activity-icon";

export type TimelineEntryData =
	RouterOutputs["activities"]["timeline"]["entries"][number];

const timeFormat = new Intl.DateTimeFormat(undefined, {
	hour: "numeric",
	minute: "2-digit",
});

/** `{ from, to }` on a STAGE_CHANGE, read back defensively — it is `Json`. */
function stageChange(meta: Record<string, unknown> | null) {
	const from = typeof meta?.from === "string" ? meta.from : null;
	const to = typeof meta?.to === "string" ? meta.to : null;
	return from && to ? { from, to } : null;
}

export function TimelineEntry({
	entry,
	/** Hide the deal/contact chips on that record's own timeline. */
	showContext = true,
}: {
	entry: TimelineEntryData;
	showContext?: boolean;
}) {
	const trpc = useTRPC();
	const cache = useCrmCache();

	const complete = useMutation(
		trpc.activities.complete.mutationOptions({
			onSuccess: () => cache.activity(),
			onError: (error) => toast.error(error.message),
		}),
	);

	const isTask = entry.type === "TASK";
	const done = entry.completedAt !== null;
	const overdue =
		isTask &&
		!done &&
		entry.dueAt !== null &&
		new Date(entry.dueAt) < new Date();

	const change = entry.type === "STAGE_CHANGE" ? stageChange(entry.meta) : null;
	const when = entry.occurredAt ?? entry.createdAt;

	return (
		<li className="flex gap-3 py-3">
			<span className="mt-0.5 text-muted-foreground">
				{isTask ? (
					<Checkbox
						checked={done}
						disabled={complete.isPending}
						aria-label={done ? "Mark as not done" : "Mark as done"}
						onCheckedChange={(checked) =>
							complete.mutate({ id: entry.id, completed: checked === true })
						}
					/>
				) : (
					<ActivityIcon type={entry.type} />
				)}
			</span>

			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
					<span className="font-medium text-sm">
						{change
							? `${dealStageLabel(change.from as never)} → ${dealStageLabel(change.to as never)}`
							: (entry.subject ?? activityLabel(entry.type))}
					</span>

					{overdue ? (
						<StatusIndicator
							tone="error"
							className="text-xs"
							label={`Overdue ${relativeTimeFromIso(entry.dueAt)}`}
						/>
					) : isTask && !done && entry.dueAt ? (
						<StatusIndicator
							tone="info"
							className="text-xs"
							label={`Due ${relativeTimeFromIso(entry.dueAt)}`}
						/>
					) : null}

					<span className="text-muted-foreground text-xs">
						{entry.createdBy.name} · {timeFormat.format(new Date(when))}
					</span>
				</div>

				{entry.body ? (
					<p className="whitespace-pre-wrap text-pretty text-muted-foreground text-sm/6">
						{entry.body}
					</p>
				) : null}

				{showContext && (entry.deal || entry.contact) ? (
					<div className="flex flex-wrap items-center gap-3 text-xs">
						{entry.deal ? (
							<RecordLink kind="deal" id={entry.deal.id}>
								{entry.deal.name}
							</RecordLink>
						) : null}
						{entry.contact ? (
							<RecordLink kind="contact" id={entry.contact.id}>
								{[entry.contact.firstName, entry.contact.lastName]
									.filter(Boolean)
									.join(" ")}
							</RecordLink>
						) : null}
					</div>
				) : null}
			</div>
		</li>
	);
}
