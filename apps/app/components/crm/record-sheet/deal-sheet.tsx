"use client";

import UserMultiple from "@carbon/icons-react/es/UserMultiple";
import { Alert, AlertDescription, AlertTitle } from "@crm/ui/components/alert";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import {
	EntityLogo,
	type EntityLogoTone,
} from "@crm/ui/components/entity-logo";
import { SimpleTable, SimpleTableRow } from "@crm/ui/components/simple-table";
import { TableCell } from "@crm/ui/components/table";
import { formatMoney, relativeTimeFromIso } from "@crm/ui/lib/format";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
	InlineField,
	InlineSelectField,
	savingField,
} from "@/components/crm/inline-field";
import { OwnerCell } from "@/components/crm/owner-cell";
import { DealStageMenu } from "@/components/crm/stage-change";
import { StageStepper } from "@/components/crm/stage-stepper";
import { Timeline } from "@/components/crm/timeline/timeline";
import {
	DetailSheetBody,
	DetailSheetEmpty,
	DetailSheetProperties,
	DetailSheetSection,
	DetailSheetStat,
	DetailSheetStats,
	type DetailSheetTab,
} from "@/components/detail-sheet";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { RecordSheetFrame } from "./record-parts";
import { useOpenRecord, useRecordSheetView } from "./record-stack";

type Deal = RouterOutputs["deals"]["byId"];

const CONTACT_COLUMNS = [
	{ header: "Name", width: "w-[30%]", className: "pl-5" },
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

/**
 * A close date is a day on a calendar, not an instant.
 *
 * `new Date("2026-07-16")` is midnight UTC, which is the 15th anywhere west of
 * it — so the field read "Jul 15" while the stats strip two inches above it,
 * formatting the full timestamp, read "Jul 16". Split the parts and build a
 * local date so both agree.
 */
function formatDay(value: string): string {
	const [year, month, day] = value.split("-").map(Number);
	if (!year || !month || !day) return value;
	return dateFormat.format(new Date(year, month - 1, day));
}

export function DealSheet({ dealId }: { dealId: string }) {
	const trpc = useTRPC();
	const openRecord = useOpenRecord();
	const { tab, setTab } = useRecordSheetView("overview");

	const query = useQuery(trpc.deals.byId.queryOptions({ id: dealId }));
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
			loading={query.isPending}
			error={query.error?.message ?? null}
			title={deal?.name ?? "Deal"}
			// A deal is always somebody's deal, so the company is the subtitle and
			// it opens rather than just naming itself.
			description={
				deal ? (
					<button
						type="button"
						onClick={() => openRecord({ kind: "company", id: deal.company.id })}
						className="text-foreground underline-offset-2 hover:underline"
					>
						{deal.company.name}
					</button>
				) : undefined
			}
			media={
				deal ? (
					<EntityLogo
						src={deal.company.iconUrl}
						darkSrc={deal.company.iconDarkUrl}
						tone={deal.company.iconTone as EntityLogoTone | null | undefined}
						name={deal.company.name}
						size="lg"
					/>
				) : null
			}
			// A deal's stage is the state it is in and the thing you change about
			// it, so it is one control in the header — the same picker the deals
			// table puts in every row — rather than a read-only cell in the stats
			// strip plus a row of buttons further down the panel.
			actions={
				deal ? (
					<DealStageMenu
						dealId={deal.id}
						stage={deal.stage}
						variant="control"
					/>
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
						{/* How long it has sat where it is — the staleness read that
						    used to be a line of small print under the title. */}
						<DetailSheetStat label="In stage">
							{relativeTimeFromIso(deal.stageChangedAt)}
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
	const cache = useCrmCache();

	const users = useQuery(trpc.users.list.queryOptions());
	const companies = useQuery(trpc.companies.options.queryOptions({ q: "" }));

	const update = useMutation(
		trpc.deals.update.mutationOptions({
			// `settle: "record"` — the row's spinner should last until the new value
			// is under it, not until the board behind the sheet and every cached
			// company have caught up too.
			onSuccess: () => cache.deal(deal.id, { settle: "record" }),
			onError: (error) => toast.error(error.message),
		}),
	);

	const save = (data: Parameters<typeof update.mutate>[0]["data"]) =>
		update.mutate({ id: deal.id, data });

	const isSaving = savingField(update);

	return (
		<DetailSheetBody>
			{/* Where the deal is, as a picture. Setting the stage — including
			 * closing it — is the control in the header; this is the one-click
			 * nudge to the next step. */}
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
				<DetailSheetProperties>
					<InlineField
						label="Name"
						value={deal.name}
						saving={isSaving("name")}
						onSave={(name) => name && save({ name })}
					/>
					<InlineField
						label="Amount"
						// Edited in whole currency; stored and summed in cents.
						value={
							deal.amountCents === null ? null : String(deal.amountCents / 100)
						}
						placeholder="24000"
						saving={isSaving("amountCents")}
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
						saving={isSaving("currency")}
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
						// Edited as `2026-12-31`, which is what a date input speaks, and
						// read as "Jul 16, 2026", which is what the stats strip two
						// inches above it says.
						value={toDateInput(deal.expectedCloseDate)}
						placeholder="2026-12-31"
						saving={isSaving("expectedCloseDate")}
						onSave={(next) => save({ expectedCloseDate: next || null })}
						render={formatDay}
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
				</DetailSheetProperties>
			</DetailSheetSection>
		</DetailSheetBody>
	);
}

function DealContacts({ deal }: { deal: Deal }) {
	const openRecord = useOpenRecord();

	if (deal.contacts.length === 0) {
		return (
			<DetailSheetEmpty
				icon={UserMultiple}
				title="No contacts on this deal"
				description={`Nobody from ${deal.company.name} is attached yet. Add people to the company, then bring them onto the deal.`}
			/>
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
					<TableCell className="truncate py-2.5 pr-3 pl-5 font-medium">
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
