"use client";

import type { DealStage } from "@crm/db/enums";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import { EntityLogo } from "@crm/ui/components/entity-logo";
import { Spinner } from "@crm/ui/components/spinner";
import { formatMoney } from "@crm/ui/lib/format";
import { cn } from "@crm/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseAsString, useQueryState, useQueryStates } from "nuqs";
import { useState } from "react";
import { toast } from "sonner";
import { dealStageLabel, LOSING_STAGES } from "@/components/crm/deal-stage";
import { OwnerCell } from "@/components/crm/owner-cell";
import { useOpenRecord } from "@/components/crm/record-sheet/record-stack";
import { DealStageMenu } from "@/components/crm/stage-change";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";

type Column = RouterOutputs["deals"]["board"]["columns"][number];
type Card = Column["cards"][number];

const dateFormat = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
});

/**
 * The open pipeline, as columns you can drag between.
 *
 * Native HTML drag and drop rather than a library: the interaction is "pick up
 * one card, drop it on one column", and that is what the platform already does.
 * Dropping onto a losing stage opens the same reason dialog the table uses —
 * the API refuses those without one either way.
 */
export function DealsBoard() {
	const openRecord = useOpenRecord();
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const [owner] = useQueryState("owner", parseAsString.withDefault("all"));
	const [q] = useQueryState("q", parseAsString.withDefault(""));
	const [, setCloseParams] = useQueryStates({
		closing: parseAsString,
		closingStage: parseAsString,
	});

	const [dragging, setDragging] = useState<string | null>(null);
	const [over, setOver] = useState<DealStage | null>(null);

	const board = useQuery({
		...trpc.deals.board.queryOptions({ q, owner, limit: 50 }),
		placeholderData: (previous) => previous,
	});

	const setStage = useMutation(
		trpc.deals.setStage.mutationOptions({
			onSuccess: async () => {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: trpc.deals.board.queryKey(),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.deals.list.queryKey(),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.companies.byId.queryKey(),
					}),
				]);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const drop = (stage: DealStage) => {
		const id = dragging;
		setDragging(null);
		setOver(null);
		if (!id) return;

		if (LOSING_STAGES.includes(stage)) {
			void setCloseParams({ closing: id, closingStage: stage });
			return;
		}
		setStage.mutate({ id, stage });
	};

	if (board.isPending) {
		return (
			<div className="flex justify-center py-12">
				<Spinner />
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
			{(board.data?.columns ?? []).map((column) => (
				/*
				 * A column is a drop target across its whole area, not just the
				 * cards in it — an empty column has to be droppable too.
				 */
				// biome-ignore lint/a11y/noStaticElementInteractions: a drop target is pointer-only by nature. Dragging is an enhancement, not the only route: every card carries the same stage menu the table rows use, which is keyboard-operable.
				<section
					key={column.stage}
					onDragOver={(event) => {
						event.preventDefault();
						setOver(column.stage);
					}}
					onDragLeave={() =>
						setOver((current) => (current === column.stage ? null : current))
					}
					onDrop={() => drop(column.stage)}
					className={cn(
						"flex w-72 shrink-0 flex-col border",
						over === column.stage && "bg-muted/50",
					)}
				>
					<header className="flex items-baseline justify-between gap-2 border-b px-3 py-2">
						<span className="truncate font-medium text-sm">
							{dealStageLabel(column.stage)}
						</span>
						<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
							{column.total} · {formatMoney(column.valueCents)}
						</span>
					</header>

					<ul className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2">
						{column.cards.map((card) => (
							<BoardCard
								key={card.id}
								card={card}
								dragging={dragging === card.id}
								onDragStart={() => setDragging(card.id)}
								onDragEnd={() => setDragging(null)}
								onOpen={() => openRecord({ kind: "deal", id: card.id })}
							/>
						))}

						{column.cards.length < column.total ? (
							<li className="py-2 text-center text-muted-foreground text-xs">
								{column.total - column.cards.length} more — narrow the filters
								to see them
							</li>
						) : null}
					</ul>
				</section>
			))}
		</div>
	);
}

function BoardCard({
	card,
	dragging,
	onDragStart,
	onDragEnd,
	onOpen,
}: {
	card: Card;
	dragging: boolean;
	onDragStart: () => void;
	onDragEnd: () => void;
	onOpen: () => void;
}) {
	return (
		<li
			draggable
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
			className={cn(
				"flex cursor-grab flex-col gap-2 border bg-background p-2.5",
				dragging && "opacity-50",
			)}
		>
			{/*
			 * The title is the clickable region rather than the whole card: the
			 * footer holds a stage menu, and a button inside a button is neither
			 * valid nor operable.
			 */}
			<button
				type="button"
				onClick={onOpen}
				className="truncate text-left font-medium text-sm hover:underline"
			>
				{card.name}
			</button>

			<span className="flex min-w-0 items-center gap-2">
				<EntityLogo
					src={card.company.iconUrl}
					name={card.company.name}
					size="sm"
				/>
				<span className="truncate text-muted-foreground text-xs">
					{card.company.name}
				</span>
			</span>

			<span className="flex items-center justify-between gap-2">
				<span className="tabular-nums text-sm">
					{card.amountCents === null ? (
						<EmptyCellValue />
					) : (
						formatMoney(card.amountCents, card.currency)
					)}
				</span>
				<span className="flex items-center gap-2">
					{card.expectedCloseDate ? (
						<span className="text-muted-foreground text-xs">
							{dateFormat.format(new Date(card.expectedCloseDate))}
						</span>
					) : null}
					<OwnerCell owner={card.owner} compact />
				</span>
			</span>

			{/* The keyboard route to the same move dragging performs. */}
			<DealStageMenu dealId={card.id} stage={card.stage} />
		</li>
	);
}
