"use client";

import Email from "@carbon/icons-react/es/Email";
import Star from "@carbon/icons-react/es/Star";
import { Button } from "@crm/ui/components/button";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import { EntityLogo } from "@crm/ui/components/entity-logo";
import { Icon } from "@crm/ui/components/icon";
import { SimpleTable, SimpleTableRow } from "@crm/ui/components/simple-table";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { TableCell } from "@crm/ui/components/table";
import { formatMoney, initialsFromName } from "@crm/ui/lib/format";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { OPEN_STAGES } from "@/components/crm/deal-stage";
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

type Contact = RouterOutputs["contacts"]["byId"];

const NONE = "none";

const DEAL_COLUMNS = [
	{ header: "Deal", width: "w-[32%]", className: "pl-4" },
	{ header: "Role", width: "w-[16%]" },
	{ header: "Stage", width: "w-[22%]" },
	{ header: "Amount", width: "w-[16%]", align: "right" as const },
	{ header: "Owner", width: "w-[14%]" },
];

function contactName(contact: {
	firstName: string;
	lastName: string | null;
}): string {
	return [contact.firstName, contact.lastName].filter(Boolean).join(" ");
}

export function ContactSheet({
	contactId,
	open,
	onOpenChange,
}: {
	contactId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [tab, setTab] = useState("overview");

	const query = useQuery({
		...trpc.contacts.byId.queryOptions({ id: contactId }),
		enabled: open,
	});

	const contact = query.data;

	const setPrimary = useMutation(
		trpc.companies.setPrimaryContact.mutationOptions({
			onSuccess: async () => {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: trpc.contacts.byId.queryKey({ id: contactId }),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.companies.byId.queryKey(),
					}),
				]);
				toast.success("Primary contact updated.");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const openDeals =
		contact?.deals.filter((deal) => OPEN_STAGES.includes(deal.stage)) ?? [];
	const openValueCents = openDeals.reduce(
		(total, deal) => total + (deal.amountCents ?? 0),
		0,
	);

	const tabs: DetailSheetTab[] = contact
		? [
				{
					value: "overview",
					label: "Overview",
					content: <ContactOverview contact={contact} />,
				},
				{
					value: "deals",
					label: "Deals",
					count: contact.deals.length,
					content: <ContactDeals contact={contact} />,
				},
				{
					value: "activity",
					label: "Activity",
					content: <Timeline anchor={{ contactId: contact.id }} />,
				},
			]
		: [];

	return (
		<RecordSheetFrame
			open={open}
			onOpenChange={onOpenChange}
			loading={query.isPending}
			error={query.error?.message ?? null}
			title={contact ? contactName(contact) : "Contact"}
			description={
				contact
					? [contact.title, contact.company?.name]
							.filter(Boolean)
							.join(" · ") || "No title or company yet."
					: undefined
			}
			// A person, so initials rather than a logo — there is no avatar in the
			// directory and a broken image placeholder is worse than two letters.
			media={
				<span className="inline-flex size-14 shrink-0 items-center justify-center border bg-muted font-medium text-lg text-muted-foreground uppercase">
					{contact ? initialsFromName(contactName(contact)) : "?"}
				</span>
			}
			eyebrow={
				contact?.isPrimaryContact ? (
					<StatusIndicator tone="success" label="Primary contact" />
				) : null
			}
			actions={
				contact ? (
					<>
						{contact.email ? (
							<Button asChild variant="outline" size="sm">
								<a href={`mailto:${contact.email}`}>
									<Icon icon={Email} data-icon="inline-start" />
									Email
								</a>
							</Button>
						) : null}
						{contact.company && !contact.isPrimaryContact ? (
							<Button
								variant="outline"
								size="sm"
								disabled={setPrimary.isPending}
								onClick={() =>
									setPrimary.mutate({
										// Narrowed by the guard above; the API re-checks that this
										// person actually works there.
										companyId: contact.company?.id ?? "",
										contactId: contact.id,
									})
								}
							>
								<Icon icon={Star} data-icon="inline-start" />
								Make primary
							</Button>
						) : null}
					</>
				) : null
			}
			stats={
				contact ? (
					<DetailSheetStats>
						<DetailSheetStat label="Company">
							{contact.company ? (
								<CompanyStat company={contact.company} />
							) : (
								<EmptyCellValue />
							)}
						</DetailSheetStat>
						<DetailSheetStat label="Deals">
							<span className="tabular-nums">{contact.deals.length}</span>
						</DetailSheetStat>
						<DetailSheetStat label="Open pipeline">
							<span className="tabular-nums">
								{formatMoney(openValueCents)}
							</span>
						</DetailSheetStat>
						<DetailSheetStat label="Owner">
							<OwnerCell owner={contact.owner} />
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

function CompanyStat({
	company,
}: {
	company: NonNullable<Contact["company"]>;
}) {
	const openRecord = useOpenRecord();

	return (
		<button
			type="button"
			onClick={() => openRecord({ kind: "company", id: company.id })}
			className="flex min-w-0 items-center gap-2 hover:underline"
		>
			<EntityLogo src={company.iconUrl} name={company.name} size="xs" />
			<span className="truncate">{company.name}</span>
		</button>
	);
}

function ContactOverview({ contact }: { contact: Contact }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const users = useQuery(trpc.users.list.queryOptions());
	const companies = useQuery(trpc.companies.options.queryOptions({ q: "" }));

	const update = useMutation(
		trpc.contacts.update.mutationOptions({
			onSuccess: async () => {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: trpc.contacts.byId.queryKey({ id: contact.id }),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.contacts.list.queryKey(),
					}),
					// Moving someone between companies changes both companies' records.
					queryClient.invalidateQueries({
						queryKey: trpc.companies.byId.queryKey(),
					}),
				]);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const save = (data: Record<string, string | null>) =>
		update.mutate({ id: contact.id, data });

	return (
		<DetailSheetBody>
			<DetailSheetSection title="Details">
				<div className="grid gap-x-8 sm:grid-cols-2">
					<InlineField
						label="First name"
						value={contact.firstName}
						saving={update.isPending}
						onSave={(firstName) => firstName && save({ firstName })}
					/>
					<InlineField
						label="Last name"
						value={contact.lastName}
						saving={update.isPending}
						onSave={(lastName) => save({ lastName })}
					/>
					<InlineField
						label="Title"
						value={contact.title}
						placeholder="Head of Security"
						saving={update.isPending}
						onSave={(title) => save({ title })}
					/>
					<InlineField
						label="Email"
						value={contact.email}
						type="email"
						saving={update.isPending}
						onSave={(email) => save({ email })}
						render={(email) => (
							<a href={`mailto:${email}`} className="hover:underline">
								{email}
							</a>
						)}
					/>
					<InlineField
						label="Phone"
						value={contact.phone}
						type="tel"
						saving={update.isPending}
						onSave={(phone) => save({ phone })}
					/>
					<InlineField
						label="LinkedIn"
						value={contact.linkedinUrl}
						type="url"
						saving={update.isPending}
						onSave={(linkedinUrl) => save({ linkedinUrl })}
					/>
					<InlineSelectField
						label="Company"
						value={contact.company?.id ?? NONE}
						options={[
							{ value: NONE, label: "No company" },
							...(companies.data ?? []).map((company) => ({
								value: company.id,
								label: company.name,
							})),
						]}
						onSave={(companyId) =>
							save({ companyId: companyId === NONE ? null : companyId })
						}
					/>
					<InlineSelectField
						label="Owner"
						value={contact.owner?.id ?? NONE}
						options={[
							{ value: NONE, label: "Unassigned" },
							...(users.data ?? []).map((user) => ({
								value: user.id,
								label: user.name,
							})),
						]}
						onSave={(ownerId) =>
							save({ ownerId: ownerId === NONE ? null : ownerId })
						}
					/>
				</div>
			</DetailSheetSection>
		</DetailSheetBody>
	);
}

function ContactDeals({ contact }: { contact: Contact }) {
	const openRecord = useOpenRecord();

	if (contact.deals.length === 0) {
		return <DetailSheetEmpty>Not on any deals yet.</DetailSheetEmpty>;
	}

	return (
		<SimpleTable variant="panel" columns={DEAL_COLUMNS}>
			{contact.deals.map((deal) => (
				<SimpleTableRow
					key={deal.id}
					clickable
					onClick={() => openRecord({ kind: "deal", id: deal.id })}
				>
					<TableCell className="truncate py-2.5 pr-3 pl-4 font-medium">
						{deal.name}
					</TableCell>
					<TableCell className="truncate px-3 py-2.5 text-muted-foreground">
						{deal.role ?? <EmptyCellValue />}
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
					<TableCell className="px-3 py-2.5">
						<OwnerCell owner={deal.owner} />
					</TableCell>
				</SimpleTableRow>
			))}
		</SimpleTable>
	);
}
