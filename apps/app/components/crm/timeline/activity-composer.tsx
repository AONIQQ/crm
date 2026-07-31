"use client";

import { Button } from "@crm/ui/components/button";
import { Input } from "@crm/ui/components/input";
import { Spinner } from "@crm/ui/components/spinner";
import { Textarea } from "@crm/ui/components/textarea";
import { ToggleGroup, ToggleGroupItem } from "@crm/ui/components/toggle-group";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/lib/trpc/client";
import { ActivityIcon, activityLabel } from "./activity-icon";
import type { TimelineAnchor } from "./timeline";

/** Only what a person can log. Stage changes and enrichment write themselves,
 * and the API's create input refuses the other two for the same reason. */
const TYPES = ["NOTE", "CALL", "EMAIL", "MEETING", "TASK"] as const;

type ComposableType = (typeof TYPES)[number];

export function ActivityComposer({ anchor }: { anchor: TimelineAnchor }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const [type, setType] = useState<ComposableType>("NOTE");
	const [subject, setSubject] = useState("");
	const [body, setBody] = useState("");
	const [dueAt, setDueAt] = useState("");

	const subjectId = useId();
	const bodyId = useId();
	const dueId = useId();

	const isTask = type === "TASK";

	const create = useMutation(
		trpc.activities.create.mutationOptions({
			onSuccess: async () => {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: trpc.activities.timeline.queryKey(),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.activities.timelineCounts.queryKey(),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.activities.myTasks.queryKey(),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.dashboard.summary.queryKey(),
					}),
					// "Last activity" columns move whenever anything is logged.
					queryClient.invalidateQueries({
						queryKey: trpc.companies.list.queryKey(),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.contacts.list.queryKey(),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.deals.list.queryKey(),
					}),
				]);
				setSubject("");
				setBody("");
				setDueAt("");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const ready = isTask ? subject.trim() !== "" : body.trim() !== "";

	return (
		<form
			className="flex flex-col gap-3 border-b pb-4"
			onSubmit={(event) => {
				event.preventDefault();
				create.mutate({
					...anchor,
					type,
					subject: subject || undefined,
					body: body || undefined,
					dueAt: isTask ? dueAt || null : undefined,
				});
			}}
		>
			<ToggleGroup
				type="single"
				value={type}
				onValueChange={(next) => next && setType(next as ComposableType)}
				variant="outline"
				size="sm"
			>
				{TYPES.map((option) => (
					<ToggleGroupItem
						key={option}
						value={option}
						aria-label={activityLabel(option)}
					>
						<ActivityIcon type={option} />
						{activityLabel(option)}
					</ToggleGroupItem>
				))}
			</ToggleGroup>

			{isTask ? (
				<>
					<Input
						id={subjectId}
						value={subject}
						onChange={(event) => setSubject(event.target.value)}
						placeholder="Send the security questionnaire"
						aria-label="What needs doing"
						autoComplete="off"
					/>
					<div className="flex flex-wrap items-center gap-2">
						<label htmlFor={dueId} className="text-muted-foreground text-xs">
							Due
						</label>
						<Input
							id={dueId}
							type="date"
							value={dueAt}
							onChange={(event) => setDueAt(event.target.value)}
						/>
					</div>
				</>
			) : (
				<>
					{type !== "NOTE" ? (
						<Input
							id={subjectId}
							value={subject}
							onChange={(event) => setSubject(event.target.value)}
							placeholder={
								type === "CALL"
									? "Discovery call"
									: type === "EMAIL"
										? "Re: next steps"
										: "Product demo"
							}
							aria-label="Subject"
							autoComplete="off"
						/>
					) : null}
					<Textarea
						id={bodyId}
						value={body}
						onChange={(event) => setBody(event.target.value)}
						placeholder={
							type === "NOTE"
								? "What happened?"
								: "What came out of it? Anything the next person needs to know."
						}
						aria-label="Details"
						rows={3}
					/>
				</>
			)}

			<div className="flex items-center justify-end gap-2">
				<Button type="submit" size="sm" disabled={create.isPending || !ready}>
					{create.isPending ? <Spinner /> : null}
					{isTask ? "Add task" : `Log ${activityLabel(type).toLowerCase()}`}
				</Button>
			</div>
		</form>
	);
}
