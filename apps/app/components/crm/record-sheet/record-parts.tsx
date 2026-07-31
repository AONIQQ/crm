"use client";

import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import { Spinner } from "@crm/ui/components/spinner";
import { formatMoney } from "@crm/ui/lib/format";
import type { ReactNode } from "react";
import {
	DetailSheet,
	DetailSheetHeader,
	type DetailSheetTab,
	DetailSheetTabs,
} from "@/components/detail-sheet";
import { RecordBack } from "./record-link";
import { useRecordStack } from "./record-stack";

/**
 * The frame every record sheet is poured into.
 *
 * The header renders before the record has loaded — a sheet has to have a
 * title from the first frame or the dialog is unlabelled, and a panel that
 * pops into existence a beat after the click reads as a bug rather than as
 * loading.
 */
export function RecordSheetFrame({
	open,
	onOpenChange,
	loading,
	error,
	title,
	description,
	media,
	eyebrow,
	actions,
	stats,
	tabs,
	tab,
	onTabChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	loading: boolean;
	error: string | null;
	title: string;
	description?: ReactNode;
	media?: ReactNode;
	eyebrow?: ReactNode;
	actions?: ReactNode;
	stats?: ReactNode;
	tabs: DetailSheetTab[];
	tab: string;
	onTabChange: (tab: string) => void;
}) {
	// The eyebrow row is skipped rather than rendered empty: `space-y` would
	// still put a gap under a zero-height div, leaving the header top-heavy on
	// the records that have nothing to say up there.
	const { stack } = useRecordStack();
	const nested = stack.length > 1;

	return (
		<DetailSheet open={open} onOpenChange={onOpenChange}>
			<DetailSheetHeader
				eyebrow={
					nested || eyebrow ? (
						<>
							<RecordBack />
							{eyebrow}
						</>
					) : null
				}
				media={media}
				title={title}
				description={description}
				actions={actions}
			/>

			{loading ? (
				<div className="flex min-h-0 flex-1 items-center justify-center">
					<Spinner />
				</div>
			) : error ? (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 p-6 text-center">
					<p className="font-medium text-sm">This record could not be loaded</p>
					<p className="text-muted-foreground text-xs">{error}</p>
				</div>
			) : (
				<>
					{stats}
					<DetailSheetTabs
						tabs={tabs}
						value={tab}
						onValueChange={onTabChange}
					/>
				</>
			)}
		</DetailSheet>
	);
}

/** Money, or the dash that means nobody has put a number on it yet. */
export function DealAmount({
	amountCents,
	currency,
}: {
	amountCents: number | null;
	currency: string;
}) {
	if (amountCents === null) return <EmptyCellValue />;
	return (
		<span className="tabular-nums">{formatMoney(amountCents, currency)}</span>
	);
}
