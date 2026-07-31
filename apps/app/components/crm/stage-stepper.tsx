"use client";

import type { DealStage } from "@crm/db/enums";
import { Button } from "@crm/ui/components/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { parseAsString, useQueryStates } from "nuqs";
import { toast } from "sonner";
import {
	CLOSED_STAGES,
	DealStageIndicator,
	dealStageLabel,
	LOSING_STAGES,
	OPEN_STAGES,
} from "@/components/crm/deal-stage";
import { useTRPC } from "@/lib/trpc/client";

/**
 * The open pipeline as a row of steps, with the closing outcomes beside it.
 *
 * Only the four open stages are steps: `CLOSED_WON`, `CLOSED_LOST` and
 * `UNQUALIFIED_TO_BUY` are outcomes, and drawing them as "further along the
 * line" would say a lost deal is progress.
 */
export function StageStepper({
	dealId,
	stage,
}: {
	dealId: string;
	stage: DealStage;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [, setCloseParams] = useQueryStates({
		closing: parseAsString,
		closingStage: parseAsString,
	});

	const setStage = useMutation(
		trpc.deals.setStage.mutationOptions({
			onSuccess: async (result) => {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: trpc.deals.byId.queryKey({ id: dealId }),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.deals.list.queryKey(),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.companies.byId.queryKey(),
					}),
				]);
				if (result.changed) toast.success("Stage updated.");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const currentIndex = OPEN_STAGES.indexOf(stage);
	const isClosed = CLOSED_STAGES.includes(stage);

	const move = (next: DealStage) => {
		if (LOSING_STAGES.includes(next)) {
			void setCloseParams({ closing: dealId, closingStage: next });
			return;
		}
		setStage.mutate({ id: dealId, stage: next });
	};

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-1">
				{OPEN_STAGES.map((option, index) => {
					const reached = !isClosed && index <= currentIndex;
					return (
						<Button
							key={option}
							variant={reached ? "secondary" : "ghost"}
							size="sm"
							aria-current={option === stage ? "step" : undefined}
							disabled={setStage.isPending}
							onClick={() => move(option)}
						>
							{dealStageLabel(option)}
						</Button>
					);
				})}
			</div>

			<div className="flex flex-wrap items-center gap-2">
				{isClosed ? (
					<>
						<DealStageIndicator stage={stage} className="text-sm" />
						<Button
							variant="outline"
							size="sm"
							disabled={setStage.isPending}
							onClick={() => move("DEMO_BOOKED")}
						>
							Reopen
						</Button>
					</>
				) : (
					CLOSED_STAGES.map((option) => (
						<Button
							key={option}
							variant="outline"
							size="sm"
							disabled={setStage.isPending}
							onClick={() => move(option)}
						>
							{dealStageLabel(option)}
						</Button>
					))
				)}
			</div>
		</div>
	);
}
