"use client";

import type { DealStage } from "@crm/db/enums";
import { Button } from "@crm/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@crm/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@crm/ui/components/dropdown-menu";
import { Field, FieldLabel } from "@crm/ui/components/field";
import { Spinner } from "@crm/ui/components/spinner";
import { Textarea } from "@crm/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { parseAsString, useQueryStates } from "nuqs";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/lib/trpc/client";
import {
	DEAL_STAGE_OPTIONS,
	DealStageIndicator,
	LOSING_STAGES,
} from "./deal-stage";

/**
 * Which deal is being closed out, and to what.
 *
 * In the URL rather than component state so one dialog can serve every row of
 * the table as well as the detail page — and so a half-finished "why did we
 * lose this?" survives a refresh instead of silently discarding the answer.
 */
const closeReasonParams = {
	closing: parseAsString,
	closingStage: parseAsString,
};

/** Invalidates everywhere a stage is visible. */
function useStageMutation(onDone?: () => void) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	return useMutation(
		trpc.deals.setStage.mutationOptions({
			onSuccess: async () => {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: trpc.deals.list.queryKey(),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.deals.byId.queryKey(),
					}),
					// A stage change writes a STAGE_CHANGE activity stamped with the
					// company, so the company page's timeline and last-activity change
					// too.
					queryClient.invalidateQueries({
						queryKey: trpc.companies.byId.queryKey(),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.companies.list.queryKey(),
					}),
				]);
				onDone?.();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
}

/**
 * The stage picker that appears on a deal row and on the deal page.
 *
 * Losing stages divert through `CloseReasonDialog`: the API refuses them
 * without a reason, so asking here is friendlier than a toast full of the
 * rejection.
 */
export function DealStageMenu({
	dealId,
	stage,
}: {
	dealId: string;
	stage: DealStage;
}) {
	const [, setCloseParams] = useQueryStates(closeReasonParams);
	const setStage = useStageMutation();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				{/* The row underneath opens a record on click; this control does not. */}
				<button
					type="button"
					onClick={(event) => event.stopPropagation()}
					disabled={setStage.isPending}
					className="flex min-w-0 items-center text-left hover:text-foreground disabled:opacity-50"
				>
					<DealStageIndicator stage={stage} />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				className="min-w-52"
				onClick={(event) => event.stopPropagation()}
			>
				<DropdownMenuRadioGroup
					value={stage}
					onValueChange={(next) => {
						const chosen = next as DealStage;
						if (chosen === stage) return;
						if (LOSING_STAGES.includes(chosen)) {
							void setCloseParams({
								closing: dealId,
								closingStage: chosen,
							});
							return;
						}
						setStage.mutate({ id: dealId, stage: chosen });
					}}
				>
					{DEAL_STAGE_OPTIONS.map((option) => (
						<DropdownMenuRadioItem key={option.value} value={option.value}>
							{option.label}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * Asks why a deal was lost or disqualified.
 *
 * Rendered once per page; which deal it is about comes from the URL, so every
 * row can open it without each one carrying a dialog of its own.
 */
export function CloseReasonDialog() {
	const reasonId = useId();
	const [{ closing, closingStage }, setCloseParams] =
		useQueryStates(closeReasonParams);
	const [reason, setReason] = useState("");

	const close = () => {
		setReason("");
		void setCloseParams({ closing: null, closingStage: null });
	};

	const setStage = useStageMutation(() => {
		toast.success("Deal closed.");
		close();
	});

	const stage = closingStage as DealStage | null;
	const open = Boolean(closing && stage);

	return (
		<Dialog open={open} onOpenChange={(next) => !next && close()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{stage === "CLOSED_LOST" ? "Close as lost" : "Mark as unqualified"}
					</DialogTitle>
					<DialogDescription>
						{stage === "CLOSED_LOST"
							? "What did we lose it to? This is the only place that answer gets recorded."
							: "Why is this not a fit? It goes on the timeline so nobody re-runs the same deal."}
					</DialogDescription>
				</DialogHeader>

				<form
					id="close-reason"
					className="px-4"
					onSubmit={(event) => {
						event.preventDefault();
						if (!closing || !stage) return;
						setStage.mutate({ id: closing, stage, closedReason: reason });
					}}
				>
					<Field>
						<FieldLabel htmlFor={reasonId}>Reason</FieldLabel>
						<Textarea
							id={reasonId}
							value={reason}
							onChange={(event) => setReason(event.target.value)}
							placeholder="Went with an incumbent vendor"
							rows={3}
						/>
					</Field>
				</form>

				<DialogFooter>
					<Button
						type="submit"
						form="close-reason"
						disabled={setStage.isPending || reason.trim() === ""}
					>
						{setStage.isPending ? <Spinner /> : null}
						Save
					</Button>
					<Button variant="outline" onClick={close}>
						Cancel
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
