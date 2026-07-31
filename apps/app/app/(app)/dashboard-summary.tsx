"use client";

import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { Checkbox } from "@crm/ui/components/checkbox";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import { Separator } from "@crm/ui/components/separator";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { formatMoney, relativeTimeFromIso } from "@crm/ui/lib/format";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { dealStageLabel } from "@/components/crm/deal-stage";
import { OwnerCell } from "@/components/crm/owner-cell";
import { RecordLink } from "@/components/crm/record-sheet/record-link";
import { useOpenRecord } from "@/components/crm/record-sheet/record-stack";
import {
	ActivityIcon,
	activityLabel,
} from "@/components/crm/timeline/activity-icon";
import { useTRPC } from "@/lib/trpc/client";

const dateFormat = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
});

export function DashboardSummary() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const openRecord = useOpenRecord();

	const { data } = useSuspenseQuery(trpc.dashboard.summary.queryOptions());

	const complete = useMutation(
		trpc.activities.complete.mutationOptions({
			onSuccess: async () => {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: trpc.dashboard.summary.queryKey(),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.activities.timeline.queryKey(),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.activities.myTasks.queryKey(),
					}),
				]);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const {
		pipeline,
		wonThisMonth,
		closingThisMonth,
		overdueTasks,
		recentActivity,
	} = data;

	return (
		<div className="flex flex-col gap-6">
			<Card>
				<CardHeader>
					<CardTitle>Pipeline</CardTitle>
					<CardAction>
						<span className="text-muted-foreground text-xs">
							{pipeline.totalDeals} open ·{" "}
							<span className="tabular-nums">
								{formatMoney(pipeline.totalCents)}
							</span>
						</span>
					</CardAction>
				</CardHeader>
				<Separator />
				<CardContent>
					<div className="grid gap-3 @md/page-content:grid-cols-2 @3xl/page-content:grid-cols-4">
						{pipeline.stages.map((stage) => (
							<Link
								key={stage.stage}
								href={`/deals?stage=${stage.stage}`}
								className="flex flex-col gap-1 border p-3 hover:bg-muted/40"
							>
								<span className="text-muted-foreground text-xs">
									{dealStageLabel(stage.stage)}
								</span>
								<span className="font-medium text-xl tabular-nums">
									{formatMoney(stage.valueCents)}
								</span>
								<span className="text-muted-foreground text-xs tabular-nums">
									{stage.count} {stage.count === 1 ? "deal" : "deals"}
								</span>
							</Link>
						))}
					</div>
				</CardContent>
			</Card>

			<div className="grid gap-6 @3xl/page-content:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>Closing this month</CardTitle>
						<CardAction>
							<span className="text-muted-foreground text-xs">
								{wonThisMonth.count} won ·{" "}
								<span className="tabular-nums">
									{formatMoney(wonThisMonth.valueCents)}
								</span>
							</span>
						</CardAction>
					</CardHeader>
					<Separator />
					<CardContent>
						{closingThisMonth.length === 0 ? (
							<p className="py-6 text-center text-muted-foreground text-xs">
								Nothing is due to close this month.
							</p>
						) : (
							<ul className="divide-y">
								{closingThisMonth.map((deal) => (
									<li key={deal.id} className="flex items-center gap-3 py-2.5">
										<button
											type="button"
											onClick={() => openRecord({ kind: "deal", id: deal.id })}
											className="flex min-w-0 flex-1 flex-col text-left hover:underline"
										>
											<span className="truncate font-medium text-sm">
												{deal.name}
											</span>
											<span className="truncate text-muted-foreground text-xs">
												{deal.company.name} · {dealStageLabel(deal.stage)}
											</span>
										</button>
										<span className="shrink-0 text-muted-foreground text-xs">
											{deal.expectedCloseDate
												? dateFormat.format(new Date(deal.expectedCloseDate))
												: null}
										</span>
										<span className="shrink-0 tabular-nums text-sm">
											{deal.amountCents === null ? (
												<EmptyCellValue />
											) : (
												formatMoney(deal.amountCents, deal.currency)
											)}
										</span>
										<OwnerCell owner={deal.owner} />
									</li>
								))}
							</ul>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>My overdue tasks</CardTitle>
						<CardAction>
							{overdueTasks.length > 0 ? (
								<StatusIndicator
									tone="error"
									className="text-xs"
									label={`${overdueTasks.length} overdue`}
								/>
							) : null}
						</CardAction>
					</CardHeader>
					<Separator />
					<CardContent>
						{overdueTasks.length === 0 ? (
							<p className="py-6 text-center text-muted-foreground text-xs">
								Nothing overdue. Good.
							</p>
						) : (
							<ul className="divide-y">
								{overdueTasks.map((task) => (
									<li key={task.id} className="flex items-center gap-3 py-2.5">
										<Checkbox
											checked={false}
											disabled={complete.isPending}
											aria-label="Mark as done"
											onCheckedChange={() =>
												complete.mutate({ id: task.id, completed: true })
											}
										/>
										<span className="flex min-w-0 flex-1 flex-col">
											<span className="truncate text-sm">{task.subject}</span>
											<span className="flex min-w-0 text-xs">
												{task.deal ? (
													<RecordLink kind="deal" id={task.deal.id}>
														{task.deal.name}
													</RecordLink>
												) : task.company ? (
													<RecordLink kind="company" id={task.company.id}>
														{task.company.name}
													</RecordLink>
												) : null}
											</span>
										</span>
										<StatusIndicator
											tone="error"
											className="shrink-0 text-xs"
											label={relativeTimeFromIso(task.dueAt)}
										/>
									</li>
								))}
							</ul>
						)}
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Recent activity</CardTitle>
					<CardAction>
						<Button asChild variant="ghost" size="sm">
							<Link href="/companies">All companies</Link>
						</Button>
					</CardAction>
				</CardHeader>
				<Separator />
				<CardContent>
					{recentActivity.length === 0 ? (
						<p className="py-6 text-center text-muted-foreground text-xs">
							Nothing has happened yet.
						</p>
					) : (
						<ul className="divide-y">
							{recentActivity.map((entry) => (
								<li key={entry.id} className="flex items-start gap-3 py-2.5">
									<span className="mt-0.5 text-muted-foreground">
										<ActivityIcon type={entry.type} />
									</span>
									<span className="flex min-w-0 flex-1 flex-col">
										<span className="truncate text-sm">
											{entry.subject ?? activityLabel(entry.type)}
										</span>
										<span className="flex min-w-0 items-center gap-1 truncate text-muted-foreground text-xs">
											{entry.company ? (
												<RecordLink kind="company" id={entry.company.id}>
													{entry.company.name}
												</RecordLink>
											) : null}
											<span className="truncate">
												{entry.deal ? ` · ${entry.deal.name}` : null}
												{` · ${entry.createdBy.name}`}
											</span>
										</span>
									</span>
									<span className="shrink-0 text-muted-foreground text-xs">
										{relativeTimeFromIso(entry.createdAt)}
									</span>
								</li>
							))}
						</ul>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
