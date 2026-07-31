"use client";

import { Button } from "@crm/ui/components/button";
import { Input } from "@crm/ui/components/input";
import { Spinner } from "@crm/ui/components/spinner";
import { Textarea } from "@crm/ui/components/textarea";
import { ToggleGroup, ToggleGroupItem } from "@crm/ui/components/toggle-group";
import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import { ActivityIcon, activityLabel } from "./activity-icon";
import type { TimelineAnchor } from "./timeline";

/** Only what a person can log. Stage changes and enrichment write themselves,
 * and the API's create input refuses the other two for the same reason. */
const TYPES = ["NOTE", "CALL", "EMAIL", "MEETING", "TASK"] as const;

type ComposableType = (typeof TYPES)[number];

/**
 * Logging what just happened, without burying what already did.
 *
 * Collapsed to a single line until you click it. Expanded, it was taller than
 * the first three entries of the timeline put together, so opening a company
 * showed you a form where you expected its history — and the history is what
 * people come here to read. Writing is one click away; reading is none.
 */
export function ActivityComposer({ anchor }: { anchor: TimelineAnchor }) {
	const trpc = useTRPC();
	const cache = useCrmCache();

	const [open, setOpen] = useState(false);
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
				await cache.activity();
				setSubject("");
				setBody("");
				setDueAt("");
				setOpen(false);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const ready = isTask ? subject.trim() !== "" : body.trim() !== "";

	const dismiss = () => {
		setSubject("");
		setBody("");
		setDueAt("");
		setOpen(false);
	};

	if (!open) {
		return (
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="flex h-9 w-full items-center border bg-transparent px-3 text-left text-muted-foreground text-sm hover:border-ring hover:bg-muted/30"
			>
				Log a note, call, email, meeting or task…
			</button>
		);
	}

	return (
		<form
			className="flex flex-col gap-3"
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
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={create.isPending}
					onClick={dismiss}
				>
					Cancel
				</Button>
				<Button type="submit" size="sm" disabled={create.isPending || !ready}>
					{create.isPending ? <Spinner /> : null}
					{isTask ? "Add task" : `Log ${activityLabel(type).toLowerCase()}`}
				</Button>
			</div>
		</form>
	);
}
