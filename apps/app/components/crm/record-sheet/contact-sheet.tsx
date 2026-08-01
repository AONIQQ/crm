"use client";

import Email from "@carbon/icons-react/es/Email";
import Partnership from "@carbon/icons-react/es/Partnership";
import Star from "@carbon/icons-react/es/Star";
import { Button } from "@crm/ui/components/button";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import {
	EntityLogo,
	type EntityLogoTone,
} from "@crm/ui/components/entity-logo";
import { Icon } from "@crm/ui/components/icon";
import { SimpleTable, SimpleTableRow } from "@crm/ui/components/simple-table";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { TableCell } from "@crm/ui/components/table";
import { initialsFromName } from "@crm/ui/lib/format";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AgentPanel } from "@/components/crm/agent-panel";
import { contactName } from "@/components/crm/contact-name";
import {
	ENRICHMENT_POLL_MS,
	EnrichmentIndicator,
	isEnriching,
} from "@/components/crm/enrichment-status";
import {
	FactSuggestion,
	factsByField,
	provenanceFor,
} from "@/components/crm/facts";
import {
	InlineField,
	InlineSelectField,
	savingField,
} from "@/components/crm/inline-field";
import { OwnerCell } from "@/components/crm/owner-cell";
import { ContactSocials, hasContactLinks } from "@/components/crm/social-links";
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

const dateFormat = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	year: "numeric",
});

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

	// Polls while the agent is working, for the same reason the company sheet
	// does: enrichment is a background write with no client action behind it, so
	// there is nothing to invalidate and the only way to notice it finished is
	// to ask. Stops the moment it settles.
	const query = useQuery({
		...trpc.contacts.byId.queryOptions({ id: contactId }),
		refetchInterval: (current) => {
			const status = current.state.data?.enrichmentStatus;
			return status && isEnriching(status) ? ENRICHMENT_POLL_MS : false;
		},
	});
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
				{
					value: "agent",
					label: "Agent",
					// A tab rather than a band on the overview: the panel opens a
					// durable session the moment it mounts, and a rep flicking through
					// records should not start one on every contact they glance at.
					content: (
						<DetailSheetBody>
							<DetailSheetSection title="Ask the agent">
								<AgentPanel
									contactId={contact.id}
									contactName={contactName(contact)}
								/>
							</DetailSheetSection>
						</DetailSheetBody>
					),
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
			// Only when there is something to say. "Enriched" is the resting state
			// of every contact in here, and a row that says so on all of them is a
			// row nobody reads — which means nobody reads it when it says "failed".
			note={
				contact ? (
					<>
						{contact.isPrimaryContact ? (
							<StatusIndicator
								tone="success"
								label={`Primary contact at ${contact.company?.name ?? "this company"}`}
							/>
						) : null}
						{contact.enrichmentStatus !== "COMPLETE" ? (
							<EnrichmentIndicator
								status={contact.enrichmentStatus}
								title={contact.enrichmentError}
							/>
						) : null}
					</>
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
			<EntityLogo
				src={company.iconUrl}
				darkSrc={company.iconDarkUrl}
				tone={company.iconTone as EntityLogoTone | null | undefined}
				name={company.name}
				size="xs"
			/>
			<span className="truncate">{company.name}</span>
		</button>
	);
}

function ContactOverview({ contact }: { contact: Contact }) {
	const trpc = useTRPC();
	const cache = useCrmCache();

	const users = useQuery(trpc.users.list.queryOptions());
	const companies = useQuery(trpc.companies.options.queryOptions({ q: "" }));

	const { applied, proposed } = factsByField(contact.facts);

	/** Everything a field needs to show where it came from and what is pending. */
	const agentProps = (field: string) => {
		const fact = applied.get(field);
		const suggestion = proposed.get(field);
		return {
			provenance: fact ? provenanceFor(fact) : undefined,
			suggestion: suggestion ? (
				<FactSuggestion fact={suggestion} contactId={contact.id} />
			) : undefined,
		};
	};

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
						{...agentProps("title")}
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
						{...agentProps("linkedinUrl")}
					/>
					{/*
					 * No placeholders on these two. An empty inline field renders its
					 * placeholder as the value, so an example handle reads as this
					 * person's account rather than as a hint — and a plausible wrong
					 * link on every contact is exactly the failure the rest of this
					 * agent is built to avoid.
					 */}
					<InlineField
						label="X"
						value={contact.twitterUrl}
						type="url"
						saving={isSaving("twitterUrl")}
						onSave={(twitterUrl) => save({ twitterUrl })}
						{...agentProps("twitterUrl")}
					/>
					<InlineField
						label="GitHub"
						value={contact.githubUrl}
						type="url"
						saving={isSaving("githubUrl")}
						onSave={(githubUrl) => save({ githubUrl })}
						{...agentProps("githubUrl")}
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

			{contact.brief ? <Background brief={contact.brief} /> : null}

			<WeKnowThem
				relationship={contact.relationship}
				contactName={contactName(contact)}
			/>

			{hasContactLinks(contact) ? (
				<DetailSheetSection title="Links">
					<ContactSocials contact={contact} />
				</DetailSheetSection>
			) : null}
		</DetailSheetBody>
	);
}

/**
 * Who this person is, above the fields that describe them.
 *
 * The prose and the lines under it do different jobs and are stored separately
 * for that reason: the narrative is what a rep reads on the way into a call,
 * the lines are what they scan for one number — how long have they been there.
 *
 * Everything here was written by the agent, so the whole section is sourced
 * once at the top rather than field by field. Repeating a dotted underline on
 * six consecutive agent-written lines would decorate the section, not inform
 * anyone.
 */
function Background({ brief }: { brief: NonNullable<Contact["brief"]> }) {
	const sections = brief.sections;
	const lines = [
		{ label: "Current role", value: sections.currentRole },
		{ label: "Tenure", value: sections.tenure },
		{ label: "Previously", value: sections.previousRoles?.join(" · ") },
		{ label: "Seniority", value: sections.seniority },
		{ label: "Function", value: sections.function },
		{ label: "Based", value: sections.location },
	].filter((line) => Boolean(line.value));

	return (
		<DetailSheetSection
			title="Background"
			action={
				<span className="text-muted-foreground text-xs">
					{brief.sourceUrl ? (
						<a
							href={brief.sourceUrl}
							target="_blank"
							rel="noreferrer noopener"
							className="underline-offset-2 hover:underline"
						>
							Source
						</a>
					) : null}
					{brief.sourceUrl ? " · " : null}
					{dateFormat.format(new Date(brief.refreshedAt))}
				</span>
			}
		>
			<p className="text-pretty text-muted-foreground text-sm/6">
				{brief.narrative}
			</p>

			{lines.length > 0 ? (
				<DetailSheetProperties>
					{lines.map((line) => (
						<div
							key={line.label}
							className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-2 py-0.5"
						>
							<span className="truncate text-muted-foreground text-xs">
								{line.label}
							</span>
							<span className="min-w-0 text-sm">{line.value}</span>
						</div>
					))}
				</DetailSheetProperties>
			) : null}
		</DetailSheetSection>
	);
}

const relativeFormat = new Intl.RelativeTimeFormat(undefined, {
	numeric: "auto",
});

function daysAgo(iso: string): string {
	const days = Math.round(
		(Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24),
	);
	return relativeFormat.format(-days, "day");
}

/**
 * What we have actually said to each other.
 *
 * The block no CRM that buys its data can render. Everything above it could be
 * purchased from a vendor; this is ours, and it is the part a rep checks last
 * before dialling — have they ever replied, when, and who else do we know
 * there.
 *
 * "Never replied" is stated rather than omitted. Twelve emails into silence is
 * a fact about the relationship, and a panel that shows only the twelve reads
 * like progress.
 */
function WeKnowThem({
	relationship,
	contactName: name,
}: {
	relationship: Contact["relationship"];
	contactName: string;
}) {
	const { emails, meetings, lastReplyAt, nextMeeting, colleagues } =
		relationship;

	if (emails === 0 && meetings === 0 && colleagues.length === 0) return null;

	const first = name.split(" ")[0] ?? name;

	const summary = [
		emails > 0 ? `${emails} email${emails === 1 ? "" : "s"}` : null,
		emails > 0
			? lastReplyAt
				? `last reply ${daysAgo(lastReplyAt)}`
				: `${first} has never replied`
			: null,
		meetings > 0 ? `${meetings} meeting${meetings === 1 ? "" : "s"}` : null,
	].filter(Boolean);

	return (
		<DetailSheetSection title="We know them">
			{summary.length > 0 ? (
				<p className="text-muted-foreground text-sm/6">{summary.join(" · ")}</p>
			) : null}

			{nextMeeting ? (
				<p className="text-sm">
					<span className="text-muted-foreground">Next </span>
					{nextMeeting.title ?? "Meeting"}
					<span className="text-muted-foreground">
						{" · "}
						{dateFormat.format(new Date(nextMeeting.startsAt))}
					</span>
				</p>
			) : null}

			{colleagues.length > 0 ? <Colleagues colleagues={colleagues} /> : null}
		</DetailSheetSection>
	);
}

function Colleagues({
	colleagues,
}: {
	colleagues: Contact["relationship"]["colleagues"];
}) {
	const openRecord = useOpenRecord();

	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
			<span className="text-muted-foreground text-xs">Also here</span>
			{colleagues.map((colleague) => (
				<button
					key={colleague.id}
					type="button"
					onClick={() => openRecord({ kind: "contact", id: colleague.id })}
					className="min-w-0 truncate underline-offset-2 hover:underline"
				>
					{colleague.name}
					{colleague.title ? (
						<span className="text-muted-foreground"> ({colleague.title})</span>
					) : null}
				</button>
			))}
		</div>
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
