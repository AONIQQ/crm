"use client";

import Email from "@carbon/icons-react/es/Email";
import Partnership from "@carbon/icons-react/es/Partnership";
import Star from "@carbon/icons-react/es/Star";
import { Button } from "@crm/ui/components/button";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import { EntityLogo } from "@crm/ui/components/entity-logo";
import { Icon } from "@crm/ui/components/icon";
import { SimpleTable, SimpleTableRow } from "@crm/ui/components/simple-table";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { TableCell } from "@crm/ui/components/table";
import { initialsFromName } from "@crm/ui/lib/format";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { contactName } from "@/components/crm/contact-name";
import {
	InlineField,
	InlineSelectField,
	savingField,
} from "@/components/crm/inline-field";
import { OwnerCell } from "@/components/crm/owner-cell";
import { DealStageMenu } from "@/components/crm/stage-change";
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
import { DealAmount, MetaLine, RecordSheetFrame } from "./record-parts";
import { useOpenRecord, useRecordSheetView } from "./record-stack";

type Contact = RouterOutputs["contacts"]["byId"];

const NONE = "none";

const DEAL_COLUMNS = [
	{ header: "Deal", width: "w-[32%]", className: "pl-5" },
	{ header: "Role", width: "w-[16%]" },
	{ header: "Stage", width: "w-[22%]" },
	{ header: "Amount", width: "w-[16%]", align: "right" as const },
	{ header: "Owner", width: "w-[14%]" },
];

export function ContactSheet({ contactId }: { contactId: string }) {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const { tab, setTab } = useRecordSheetView("overview");

	const query = useQuery(trpc.contacts.byId.queryOptions({ id: contactId }));
	const contact = query.data;

	const setPrimary = useMutation(
		trpc.companies.setPrimaryContact.mutationOptions({
			onSuccess: async () => {
				await cache.contact(contactId);
				toast.success("Primary contact updated.");
			},
			onError: (error) => toast.error(error.message),
		}),
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
			loading={query.isPending}
			error={query.error?.message ?? null}
			title={contact ? contactName(contact) : "Contact"}
			description={
				contact ? (
					<MetaLine parts={[contact.title, contact.company?.name]} />
				) : undefined
			}
			note={
				contact?.isPrimaryContact ? (
					<StatusIndicator
						tone="success"
						label={`Primary contact at ${contact.company?.name ?? "this company"}`}
					/>
				) : null
			}
			// A person, so initials rather than a logo — there are no avatars in
			// the CRM and a broken image placeholder is worse than two letters.
			media={
				<span className="inline-flex size-10 shrink-0 items-center justify-center border bg-muted font-medium text-muted-foreground text-sm uppercase">
					{contact ? initialsFromName(contactName(contact)) : "?"}
				</span>
			}
			actions={
				contact ? (
					<>
						{contact.email ? (
							<Button asChild variant="outline" size="sm">
								<a href={`mailto:${contact.email}`}>
									<Icon icon={Email} data-icon="inline-start" />
									<span className="hidden sm:inline">Email</span>
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
								<span className="hidden sm:inline">Make primary</span>
							</Button>
						) : null}
					</>
				) : null
			}
			// How to reach this person, which is what anyone opening a contact
			// wants — the deal count is already on the tab beside it.
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
						<DetailSheetStat label="Email">
							{contact.email ? (
								<a
									href={`mailto:${contact.email}`}
									className="underline-offset-2 hover:underline"
								>
									{contact.email}
								</a>
							) : (
								<EmptyCellValue />
							)}
						</DetailSheetStat>
						<DetailSheetStat label="Phone">
							{contact.phone ? (
								<a
									href={`tel:${contact.phone}`}
									className="underline-offset-2 hover:underline"
								>
									{contact.phone}
								</a>
							) : (
								<EmptyCellValue />
							)}
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
			className="flex min-w-0 items-center gap-2 underline-offset-2 hover:underline"
		>
			<EntityLogo src={company.iconUrl} name={company.name} size="xs" />
			<span className="truncate">{company.name}</span>
		</button>
	);
}

function ContactOverview({ contact }: { contact: Contact }) {
	const trpc = useTRPC();
	const cache = useCrmCache();

	const users = useQuery(trpc.users.list.queryOptions());
	const companies = useQuery(trpc.companies.options.queryOptions({ q: "" }));

	const update = useMutation(
		trpc.contacts.update.mutationOptions({
			// `settle: "record"` — the row's spinner should last until the new value
			// is under it, not until the list behind the sheet and every cached
			// company have caught up too.
			onSuccess: () => cache.contact(contact.id, { settle: "record" }),
			onError: (error) => toast.error(error.message),
		}),
	);

	const save = (data: Record<string, string | null>) =>
		update.mutate({ id: contact.id, data });

	const isSaving = savingField(update);

	return (
		<DetailSheetBody>
			<DetailSheetSection title="Details">
				<DetailSheetProperties>
					<InlineField
						label="First name"
						value={contact.firstName}
						saving={isSaving("firstName")}
						onSave={(firstName) => firstName && save({ firstName })}
					/>
					<InlineField
						label="Last name"
						value={contact.lastName}
						saving={isSaving("lastName")}
						onSave={(lastName) => save({ lastName })}
					/>
					<InlineField
						label="Title"
						value={contact.title}
						placeholder="Head of Security"
						saving={isSaving("title")}
						onSave={(title) => save({ title })}
					/>
					<InlineField
						label="Email"
						value={contact.email}
						type="email"
						saving={isSaving("email")}
						onSave={(email) => save({ email })}
					/>
					<InlineField
						label="Phone"
						value={contact.phone}
						type="tel"
						saving={isSaving("phone")}
						onSave={(phone) => save({ phone })}
					/>
					<InlineField
						label="LinkedIn"
						value={contact.linkedinUrl}
						type="url"
						saving={isSaving("linkedinUrl")}
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
				</DetailSheetProperties>
			</DetailSheetSection>
		</DetailSheetBody>
	);
}

function ContactDeals({ contact }: { contact: Contact }) {
	const openRecord = useOpenRecord();

	if (contact.deals.length === 0) {
		return (
			<DetailSheetEmpty
				icon={Partnership}
				title="Not on any deals"
				description={`${contactName(contact)} is not attached to anything being sold yet. Deals are opened on the company, then people are added to them.`}
			/>
		);
	}

	return (
		<SimpleTable variant="panel" columns={DEAL_COLUMNS}>
			{contact.deals.map((deal) => (
				<SimpleTableRow
					key={deal.id}
					clickable
					onClick={() => openRecord({ kind: "deal", id: deal.id })}
				>
					<TableCell className="truncate py-2.5 pr-3 pl-5 font-medium">
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
