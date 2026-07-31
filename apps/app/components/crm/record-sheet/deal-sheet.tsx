"use client";

import { Alert, AlertDescription, AlertTitle } from "@crm/ui/components/alert";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import { EntityLogo } from "@crm/ui/components/entity-logo";
import { SimpleTable, SimpleTableRow } from "@crm/ui/components/simple-table";
import { TableCell } from "@crm/ui/components/table";
import { formatMoney, relativeTimeFromIso } from "@crm/ui/lib/format";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { DealStageIndicator } from "@/components/crm/deal-stage";
import { InlineField, InlineSelectField } from "@/components/crm/inline-field";
import { OwnerCell } from "@/components/crm/owner-cell";
import { StageStepper } from "@/components/crm/stage-stepper";
import { Timeline } from "@/components/crm/timeline/timeline";
import {
	DetailSheetBody,
	DetailSheetEmpty,
	DetailSheetSection,
	DetailSheetStat,
	DetailSheetStats,
	type DetailSheetTab,
} from "@/components/detail-sheet";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { RecordSheetFrame } from "./record-parts";
import { useOpenRecord } from "./record-stack";

type Deal = RouterOutputs["deals"]["byId"];

const CONTACT_COLUMNS = [
	{ header: "Name", width: "w-[30%]", className: "pl-4" },
	{ header: "Role", width: "w-[20%]" },
	{ header: "Title", width: "w-[25%]" },
	{ header: "Email", width: "w-[25%]" },
];

const dateFormat = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	year: "numeric",
});

/** `2026-07-31` — what `<input type="date">` speaks. */
function toDateInput(iso: string | null): string | null {
	return iso ? (iso.slice(0, 10) ?? null) : null;
}

export function DealSheet({
	dealId,
	open,
	onOpenChange,
}: {
	dealId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const trpc = useTRPC();
	const openRecord = useOpenRecord();
	const [tab, setTab] = useState("overview");

	const query = useQuery({
		...trpc.deals.byId.queryOptions({ id: dealId }),
		enabled: open,
	});

	const deal = query.data;

	const tabs: DetailSheetTab[] = deal
		? [
				{
					value: "overview",
					label: "Overview",
					content: <DealOverview deal={deal} />,
				},
				{
					value: "contacts",
					label: "Contacts",
					count: deal.contacts.length,
					content: <DealContacts deal={deal} />,
				},
				{
					value: "activity",
					label: "Activity",
					content: <Timeline anchor={{ dealId: deal.id }} />,
				},
			]
		: [];

	return (
		<RecordSheetFrame
			open={open}
			onOpenChange={onOpenChange}
			loading={query.isPending}
			error={query.error?.message ?? null}
			title={deal?.name ?? "Deal"}
			description={
				deal ? (
					<button
						type="button"
						onClick={() => openRecord({ kind: "company", id: deal.company.id })}
						className="hover:underline"
					>
						{deal.company.name}
					</button>
				) : undefined
			}
			media={
				deal ? (
					<EntityLogo
						src={deal.company.iconUrl}
						name={deal.company.name}
						size="xl"
					/>
				) : null
			}
			eyebrow={
				deal ? (
					<>
						<DealStageIndicator stage={deal.stage} />
						<span className="text-muted-foreground">
							changed {relativeTimeFromIso(deal.stageChangedAt)}
						</span>
					</>
				) : null
			}
			stats={
				deal ? (
					<DetailSheetStats>
						<DetailSheetStat label="Amount">
							{deal.amountCents === null ? (
								<EmptyCellValue />
							) : (
								<span className="tabular-nums">
									{formatMoney(deal.amountCents, deal.currency)}
								</span>
							)}
						</DetailSheetStat>
						<DetailSheetStat label="Expected close">
							{deal.expectedCloseDate ? (
								dateFormat.format(new Date(deal.expectedCloseDate))
							) : (
								<EmptyCellValue />
							)}
						</DetailSheetStat>
						<DetailSheetStat label="Contacts">
							<span className="tabular-nums">{deal.contacts.length}</span>
						</DetailSheetStat>
						<DetailSheetStat label="Owner">
							<OwnerCell owner={deal.owner} />
						</DetailSheetStat>
					</DetailSheetStats>
				) : null
			}
			tabs={tabs}
			tab={tab}
			onTabChange={setTab}
		/>
	);
}

function DealOverview({ deal }: { deal: Deal }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const users = useQuery(trpc.users.list.queryOptions());
	const companies = useQuery(trpc.companies.options.queryOptions({ q: "" }));

	const update = useMutation(
		trpc.deals.update.mutationOptions({
			onSuccess: async () => {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: trpc.deals.byId.queryKey({ id: deal.id }),
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

	const save = (data: Parameters<typeof update.mutate>[0]["data"]) =>
		update.mutate({ id: deal.id, data });

	return (
		<DetailSheetBody>
			{/* Moving a deal along is the most common thing anyone does here, so it
			 * is the first thing in the sheet rather than a field in a list. */}
			<DetailSheetSection title="Stage">
				<StageStepper dealId={deal.id} stage={deal.stage} />
			</DetailSheetSection>

			{deal.closedReason ? (
				<DetailSheetSection>
					<Alert>
						<AlertTitle>
							{deal.closedAt
								? `Closed ${dateFormat.format(new Date(deal.closedAt))}`
								: "Closed"}
						</AlertTitle>
						<AlertDescription>{deal.closedReason}</AlertDescription>
					</Alert>
				</DetailSheetSection>
			) : null}

			<DetailSheetSection title="Details">
				<div className="grid gap-x-8 sm:grid-cols-2">
					<InlineField
						label="Name"
						value={deal.name}
						saving={update.isPending}
						onSave={(name) => name && save({ name })}
					/>
					<InlineField
						label="Amount"
						// Edited in whole currency; stored and summed in cents.
						value={
							deal.amountCents === null ? null : String(deal.amountCents / 100)
						}
						placeholder="24000"
						saving={update.isPending}
						onSave={(next) => {
							if (next === "") return save({ amountCents: null });
							const parsed = Number.parseFloat(next);
							if (!Number.isFinite(parsed) || parsed < 0) {
								toast.error("Amount has to be a number.");
								return;
							}
							save({ amountCents: Math.round(parsed * 100) });
						}}
						render={(value) =>
							formatMoney(Math.round(Number(value) * 100), deal.currency)
						}
					/>
					<InlineField
						label="Currency"
						value={deal.currency}
						saving={update.isPending}
						onSave={(currency) => {
							if (currency.length !== 3) {
								toast.error("Use a three-letter currency code, like USD.");
								return;
							}
							save({ currency: currency.toUpperCase() });
						}}
					/>
					<InlineField
						label="Close date"
						value={toDateInput(deal.expectedCloseDate)}
						placeholder="2026-12-31"
						saving={update.isPending}
						onSave={(next) => save({ expectedCloseDate: next || null })}
					/>
					<InlineSelectField
						label="Company"
						value={deal.company.id}
						options={(companies.data ?? []).map((company) => ({
							value: company.id,
							label: company.name,
						}))}
						onSave={(companyId) => save({ companyId })}
					/>
					<InlineSelectField
						label="Owner"
						value={deal.owner.id}
						options={(users.data ?? []).map((user) => ({
							value: user.id,
							label: user.name,
						}))}
						onSave={(ownerId) => save({ ownerId })}
					/>
				</div>
			</DetailSheetSection>
		</DetailSheetBody>
	);
}

function DealContacts({ deal }: { deal: Deal }) {
	const openRecord = useOpenRecord();

	if (deal.contacts.length === 0) {
		return (
			<DetailSheetEmpty>
				Nobody from {deal.company.name} is on this deal yet.
			</DetailSheetEmpty>
		);
	}

	return (
		<SimpleTable variant="panel" columns={CONTACT_COLUMNS}>
			{deal.contacts.map((contact) => (
				<SimpleTableRow
					key={contact.id}
					clickable
					onClick={() => openRecord({ kind: "contact", id: contact.id })}
				>
					<TableCell className="truncate py-2.5 pr-3 pl-4 font-medium">
						{[contact.firstName, contact.lastName].filter(Boolean).join(" ")}
					</TableCell>
					<TableCell className="truncate px-3 py-2.5">
						{contact.role ?? <EmptyCellValue />}
					</TableCell>
					<TableCell className="truncate px-3 py-2.5 text-muted-foreground">
						{contact.title ?? <EmptyCellValue />}
					</TableCell>
					<TableCell className="truncate px-3 py-2.5 text-muted-foreground">
						{contact.email ?? <EmptyCellValue />}
					</TableCell>
				</SimpleTableRow>
			))}
		</SimpleTable>
	);
}
