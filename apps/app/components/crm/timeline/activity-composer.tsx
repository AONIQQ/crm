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

const SUBJECT_PLACEHOLDER: Partial<Record<ComposableType, string>> = {
	CALL: "Discovery call",
	EMAIL: "Re: next steps",
	MEETING: "Product demo",
};

/**
 * Logging what just happened, in one field that is always there.
 *
 * There used to be an `open` boolean: the panel showed a button pretending to
 * be an input, and clicking it swapped in a form four times the height. Two
 * problems, and the second is the one that mattered. Reading the timeline is
 * what people come here for, and the expanded form pushed the first entry off
 * the fold — so the state you were left in after logging one note was the state
 * that hid the history. The click was the tax; the mode was the bug.
 *
 * Now there is no mode. One line of textarea sits at the top, `field-sizing`
 * grows it as you type, and the things that only matter once you have started —
 * what kind of thing this is, its subject, when it is due — appear underneath
 * when there is something to attach them to. Empty, the whole composer is
 * shorter than the button that used to open it.
 *
 * What is left in `useState` is the draft itself, which is the one thing that
 * genuinely belongs there: a half-written note about a customer has no business
 * in the URL, where `record-stack` keeps the rest of this panel's state.
 */
export function ActivityComposer({ anchor }: { anchor: TimelineAnchor }) {
	const trpc = useTRPC();
	const cache = useCrmCache();

	const [type, setType] = useState<ComposableType>("NOTE");
	const [draft, setDraft] = useState("");
	const [subject, setSubject] = useState("");
	const [dueAt, setDueAt] = useState("");

	const subjectId = useId();
	const dueId = useId();

	const isTask = type === "TASK";

	// One rule for every type: the box you typed in holds the point of the
	// entry. For a task that is what needs doing, so it lands in `subject`;
	// for everything else it is the body. The old form asked a different
	// question per type and then disagreed with itself about which one made the
	// submit button live.
	const text = draft.trim();
	const started = text !== "";

	const reset = () => {
		setDraft("");
		setSubject("");
		setDueAt("");
	};

	const create = useMutation(
		trpc.activities.create.mutationOptions({
			onSuccess: async () => {
				await cache.activity();
				reset();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const submit = () => {
		if (!started || create.isPending) return;
		create.mutate({
			...anchor,
			type,
			subject: isTask ? text : subject || undefined,
			body: isTask ? undefined : text,
			dueAt: isTask ? dueAt || null : undefined,
		});
	};

	return (
		<form
			className="flex flex-col gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<Textarea
				size="sm"
				value={draft}
				onChange={(event) => setDraft(event.target.value)}
				placeholder="Log a note, call, email, meeting or task…"
				aria-label="What happened"
				onKeyDown={(event) => {
					// Submit without leaving the keyboard. Plain Enter has to stay a
					// newline — this is the field a three-paragraph call note goes in.
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
						event.preventDefault();
						submit();
					}
					if (event.key === "Escape") reset();
				}}
			/>

			{started ? (
				<>
					<div className="flex flex-wrap items-center justify-between gap-2">
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

						<Button type="submit" size="sm" disabled={create.isPending}>
							{create.isPending ? <Spinner /> : null}
							{isTask ? "Add task" : `Log ${activityLabel(type).toLowerCase()}`}
						</Button>
					</div>

					{isTask ? (
						<div className="flex flex-wrap items-center gap-2">
							<label htmlFor={dueId} className="text-muted-foreground text-xs">
								Due
							</label>
							{/* A width on the wrapper, not on the control: `Input` is
							    `w-full` by design and a date is eight characters wide. */}
							<div className="w-40">
								<Input
									id={dueId}
									type="date"
									value={dueAt}
									onChange={(event) => setDueAt(event.target.value)}
								/>
							</div>
						</div>
					) : SUBJECT_PLACEHOLDER[type] ? (
						<Input
							id={subjectId}
							value={subject}
							onChange={(event) => setSubject(event.target.value)}
							placeholder={SUBJECT_PLACEHOLDER[type]}
							aria-label="Subject"
							autoComplete="off"
						/>
					) : null}
				</>
			) : null}
		</form>
	);
}
