"use client";

import Launch from "@carbon/icons-react/es/Launch";
import Star from "@carbon/icons-react/es/Star";
import StarFilled from "@carbon/icons-react/es/StarFilled";
import { Button } from "@crm/ui/components/button";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import { EntityLogo } from "@crm/ui/components/entity-logo";
import { Icon } from "@crm/ui/components/icon";
import { SimpleTable, SimpleTableRow } from "@crm/ui/components/simple-table";
import { TableCell } from "@crm/ui/components/table";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@crm/ui/components/tooltip";
import { formatMoney } from "@crm/ui/lib/format";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { CompanySocials } from "@/components/crm/company-socials";
import { OPEN_STAGES } from "@/components/crm/deal-stage";
import { EnrichmentActions } from "@/components/crm/enrichment-actions";
import { EnrichmentIndicator } from "@/components/crm/enrichment-status";
import { InlineField, InlineSelectField } from "@/components/crm/inline-field";
import { OwnerCell } from "@/components/crm/owner-cell";
import { DealStageMenu } from "@/components/crm/stage-change";
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
import { DealAmount, RecordSheetFrame } from "./record-parts";
import { useOpenRecord } from "./record-stack";

type Company = RouterOutputs["companies"]["byId"];

const UNASSIGNED = "unassigned";

const CONTACT_COLUMNS = [
	{ srLabel: "Primary", width: "w-10", className: "pl-4" },
	{ header: "Name", width: "w-[28%]" },
	{ header: "Title", width: "w-[24%]" },
	{ header: "Email", width: "w-[26%]" },
	{ header: "Owner", width: "w-[22%]" },
];

const DEAL_COLUMNS = [
	{ header: "Deal", width: "w-[32%]", className: "pl-4" },
	{ header: "Stage", width: "w-[24%]" },
	{ header: "Amount", width: "w-[16%]", align: "right" as const },
	{ header: "Close date", width: "w-[14%]" },
	{ header: "Owner", width: "w-[14%]" },
];

const dateFormat = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	year: "numeric",
});

/**
 * A company, everything attached to it, and the agent's work on it.
 *
 * Polls while the agent is running: enrichment is a background write with no
 * client action behind it, so there is nothing to invalidate — the only way to
 * notice it finished is to ask. The interval stops the moment it settles.
 */
export function CompanySheet({
	companyId,
	open,
	onOpenChange,
}: {
	companyId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const trpc = useTRPC();
	const [tab, setTab] = useState("overview");

	const query = useQuery({
		...trpc.companies.byId.queryOptions({ id: companyId }),
		enabled: open,
		refetchInterval: (current) => {
			const status = current.state.data?.enrichmentStatus;
			return status === "PENDING" || status === "RUNNING" ? 3_000 : false;
		},
	});

	const company = query.data;

	const location = company
		? [company.city, company.stateCode, company.country]
				.filter(Boolean)
				.join(", ")
		: "";

	const openDeals =
		company?.deals.filter((deal) => OPEN_STAGES.includes(deal.stage)) ?? [];
	const openValueCents = openDeals.reduce(
		(total, deal) => total + (deal.amountCents ?? 0),
		0,
	);

	const tabs: DetailSheetTab[] = company
		? [
				{
					value: "overview",
					label: "Overview",
					content: <CompanyOverview company={company} />,
				},
				{
					value: "contacts",
					label: "Contacts",
					count: company.contacts.length,
					content: <CompanyContacts company={company} />,
				},
				{
					value: "deals",
					label: "Deals",
					count: company.deals.length,
					content: <CompanyDeals company={company} />,
				},
				{
					value: "activity",
					label: "Activity",
					content: <Timeline anchor={{ companyId: company.id }} />,
				},
			]
		: [];

	return (
		<RecordSheetFrame
			open={open}
			onOpenChange={onOpenChange}
			loading={query.isPending}
			error={query.error?.message ?? null}
			title={company?.name ?? "Company"}
			description={
				company
					? [company.domain, location, company.industry]
							.filter(Boolean)
							.join(" · ") ||
						"No domain yet — add one and the agent will fill in the rest."
					: undefined
			}
			media={
				<EntityLogo
					src={company?.iconUrl ?? company?.logoUrl}
					name={company?.name ?? "?"}
					size="xl"
				/>
			}
			eyebrow={
				company ? (
					<EnrichmentIndicator
						status={company.enrichmentStatus}
						title={company.enrichmentError}
					/>
				) : null
			}
			actions={
				company ? (
					<>
						{company.website ? (
							<Button asChild variant="outline" size="sm">
								<a
									href={company.website}
									target="_blank"
									rel="noreferrer noopener"
								>
									<Icon icon={Launch} data-icon="inline-start" />
									Visit site
								</a>
							</Button>
						) : null}
						<EnrichmentActions
							companyId={company.id}
							hasDomain={company.domain !== null}
						/>
					</>
				) : null
			}
			stats={
				company ? (
					<DetailSheetStats>
						<DetailSheetStat label="Contacts">
							<span className="tabular-nums">{company.contacts.length}</span>
						</DetailSheetStat>
						<DetailSheetStat label="Open deals">
							<span className="tabular-nums">{openDeals.length}</span>
						</DetailSheetStat>
						<DetailSheetStat label="Open pipeline">
							<span className="tabular-nums">
								{formatMoney(openValueCents)}
							</span>
						</DetailSheetStat>
						<DetailSheetStat label="Owner">
							<OwnerCell owner={company.owner} />
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

function CompanyOverview({ company }: { company: Company }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const users = useQuery(trpc.users.list.queryOptions());

	const update = useMutation(
		trpc.companies.update.mutationOptions({
			onSuccess: async () => {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: trpc.companies.byId.queryKey({ id: company.id }),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.companies.list.queryKey(),
					}),
				]);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const save = (data: Record<string, string | null>) =>
		update.mutate({ id: company.id, data });

	return (
		<DetailSheetBody>
			{/*
			 * Only the fields a rep would correct by hand are editable: the brand,
			 * industry and socials come from the agent, and a text box inviting
			 * someone to retype them is a text box inviting someone to fight it.
			 */}
			<DetailSheetSection title="Details">
				<div className="grid gap-x-8 sm:grid-cols-2">
					<InlineField
						label="Name"
						value={company.name}
						saving={update.isPending}
						onSave={(name) => name && save({ name })}
					/>
					<InlineField
						label="Domain"
						value={company.domain}
						type="url"
						placeholder="stripe.com"
						saving={update.isPending}
						onSave={(domain) => save({ domain })}
					/>
					<InlineField
						label="Website"
						value={company.website}
						type="url"
						placeholder="https://stripe.com"
						saving={update.isPending}
						onSave={(website) => save({ website })}
					/>
					<InlineField
						label="Phone"
						value={company.phone}
						type="tel"
						saving={update.isPending}
						onSave={(phone) => save({ phone })}
					/>
					<InlineField
						label="Email"
						value={company.email}
						type="email"
						saving={update.isPending}
						onSave={(email) => save({ email })}
					/>
					<InlineField
						label="City"
						value={company.city}
						saving={update.isPending}
						onSave={(city) => save({ city })}
					/>
					<InlineField
						label="Country"
						value={company.country}
						saving={update.isPending}
						onSave={(country) => save({ country })}
					/>
					<InlineSelectField
						label="Owner"
						value={company.owner?.id ?? UNASSIGNED}
						options={[
							{ value: UNASSIGNED, label: "Unassigned" },
							...(users.data ?? []).map((user) => ({
								value: user.id,
								label: user.name,
							})),
						]}
						onSave={(ownerId) =>
							save({ ownerId: ownerId === UNASSIGNED ? null : ownerId })
						}
					/>
				</div>
			</DetailSheetSection>

			{company.description ? (
				<DetailSheetSection title="About">
					<p className="text-pretty text-muted-foreground text-sm/6">
						{company.description}
					</p>
				</DetailSheetSection>
			) : null}

			<CompanyLinks company={company} />
		</DetailSheetBody>
	);
}

/**
 * Renders nothing until the agent has found somewhere to link to — a heading
 * over an empty row of icons says "broken", not "not enriched yet".
 */
function CompanyLinks({ company }: { company: Company }) {
	const hasAny = [
		company.website,
		company.linkedinUrl,
		company.twitterUrl,
		company.githubUrl,
		company.pricingUrl,
		company.careersUrl,
	].some(Boolean);

	if (!hasAny) return null;

	return (
		<DetailSheetSection title="Links">
			<CompanySocials company={company} />
		</DetailSheetSection>
	);
}

function CompanyContacts({ company }: { company: Company }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const openRecord = useOpenRecord();

	const setPrimary = useMutation(
		trpc.companies.setPrimaryContact.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: trpc.companies.byId.queryKey({ id: company.id }),
				});
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (company.contacts.length === 0) {
		return <DetailSheetEmpty>Nobody here yet.</DetailSheetEmpty>;
	}

	return (
		<SimpleTable variant="panel" columns={CONTACT_COLUMNS}>
			{company.contacts.map((contact) => {
				const isPrimary = contact.id === company.primaryContactId;
				return (
					<SimpleTableRow
						key={contact.id}
						clickable
						onClick={() => openRecord({ kind: "contact", id: contact.id })}
					>
						<TableCell className="w-10 py-2.5 pl-4">
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										variant="ghost"
										size="icon-xs"
										aria-pressed={isPrimary}
										disabled={isPrimary || setPrimary.isPending}
										// Without this the row's own handler fires too and opens
										// the contact over the change just made.
										onClick={(event) => {
											event.stopPropagation();
											setPrimary.mutate({
												companyId: company.id,
												contactId: contact.id,
											});
										}}
									>
										<Icon icon={isPrimary ? StarFilled : Star} />
										<span className="sr-only">
											{isPrimary ? "Primary contact" : "Make primary"}
										</span>
									</Button>
								</TooltipTrigger>
								<TooltipContent>
									{isPrimary ? "Primary contact" : "Make primary"}
								</TooltipContent>
							</Tooltip>
						</TableCell>
						<TableCell className="truncate px-3 py-2.5 font-medium">
							{[contact.firstName, contact.lastName].filter(Boolean).join(" ")}
						</TableCell>
						<TableCell className="truncate px-3 py-2.5">
							{contact.title ?? <EmptyCellValue />}
						</TableCell>
						<TableCell className="truncate px-3 py-2.5 text-muted-foreground">
							{contact.email ?? <EmptyCellValue />}
						</TableCell>
						<TableCell className="px-3 py-2.5">
							<OwnerCell owner={contact.owner} />
						</TableCell>
					</SimpleTableRow>
				);
			})}
		</SimpleTable>
	);
}

function CompanyDeals({ company }: { company: Company }) {
	const openRecord = useOpenRecord();

	if (company.deals.length === 0) {
		return <DetailSheetEmpty>No deals yet.</DetailSheetEmpty>;
	}

	return (
		<SimpleTable variant="panel" columns={DEAL_COLUMNS}>
			{company.deals.map((deal) => (
				<SimpleTableRow
					key={deal.id}
					clickable
					onClick={() => openRecord({ kind: "deal", id: deal.id })}
				>
					<TableCell className="truncate py-2.5 pr-3 pl-4 font-medium">
						{deal.name}
					</TableCell>
					<TableCell className="px-3 py-2.5">
						<DealStageMenu dealId={deal.id} stage={deal.stage} />
					</TableCell>
					<TableCell className="px-3 py-2.5 text-right">
						<DealAmount
							amountCents={deal.amountCents}
							currency={deal.currency}
						/>
					</TableCell>
					<TableCell className="px-3 py-2.5 text-muted-foreground">
						{deal.expectedCloseDate ? (
							dateFormat.format(new Date(deal.expectedCloseDate))
						) : (
							<EmptyCellValue />
						)}
					</TableCell>
					<TableCell className="px-3 py-2.5">
						<OwnerCell owner={deal.owner} />
					</TableCell>
				</SimpleTableRow>
			))}
		</SimpleTable>
	);
}
