"use client";

import ArrowLeft from "@carbon/icons-react/es/ArrowLeft";
import Close from "@carbon/icons-react/es/Close";
import { Button } from "@crm/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@crm/ui/components/empty";
import type { CarbonIcon } from "@crm/ui/components/icon";
import { Icon } from "@crm/ui/components/icon";
import { Separator } from "@crm/ui/components/separator";
import type { SheetSize } from "@crm/ui/components/sheet";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@crm/ui/components/tabs";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@crm/ui/components/tooltip";
import { cn } from "@crm/ui/lib/utils";
import { type ReactNode, useRef } from "react";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/responsive-sheet";

/** One gutter for the whole panel, so every band lines up down the left edge. */
const GUTTER = "px-5";

/**
 * Section headings are eyebrows, not titles.
 *
 * The only title in a record sheet is the record's name. "Details" and "About"
 * are labels on a filing cabinet — they need to be findable when you scan for
 * them and invisible when you are not.
 */
const SECTION_TITLE =
	"font-medium text-muted-foreground text-xs uppercase tracking-wider";

/**
 * The chrome every record sheet is built from.
 *
 * One shape for all of them — header, a strip of numbers, tabs, a scrolling
 * body — so a rep who has opened a company knows where everything is on a deal
 * without looking.
 *
 * `showCloseButton={false}`: the close control is part of the header's action
 * group instead of floating over the top-right corner, which is the only way
 * a record's own buttons can sit up there without being crowded by it.
 */
export function DetailSheet({
	open,
	onOpenChange,
	size = "2xl",
	className,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	size?: SheetSize;
	className?: string;
	children: ReactNode;
}) {
	const content = useRef<HTMLDivElement>(null);

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				ref={content}
				side="right"
				size={size}
				showCloseButton={false}
				// Opening a record is a read, not a form. Left alone, Radix puts
				// focus on the first control in the panel, so the sheet arrives with
				// a focus ring already drawn on a button nobody pressed. Focusing the
				// panel itself keeps assistive tech inside the dialog and announces
				// the record's name, without anything looking pre-clicked.
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					content.current?.focus();
				}}
				className={cn("flex flex-col gap-0 p-0", className)}
			>
				{children}
			</SheetContent>
		</Sheet>
	);
}

export function DetailSheetHeader({
	media,
	title,
	description,
	note,
	actions,
	onBack,
	onClose,
}: {
	media?: ReactNode;
	title: ReactNode;
	/** The one line that says what this is — domain, company, location. */
	description?: ReactNode;
	/** Only when there is something to say: an agent running, a failure. */
	note?: ReactNode;
	actions?: ReactNode;
	/** Up one record, when this was opened from another one. */
	onBack?: () => void;
	onClose: () => void;
}) {
	return (
		<SheetHeader className={cn("gap-0 border-b py-4", GUTTER)}>
			<div className="flex items-start gap-3">
				{onBack ? (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant="ghost" size="icon-sm" onClick={onBack}>
								<Icon icon={ArrowLeft} />
								<span className="sr-only">Back</span>
							</Button>
						</TooltipTrigger>
						<TooltipContent>Back</TooltipContent>
					</Tooltip>
				) : null}

				{media}

				<div className="min-w-0 flex-1 space-y-1 pt-0.5">
					<SheetTitle size="lg" className="wrap-anywhere">
						{title}
					</SheetTitle>
					{description ? (
						<SheetDescription className="wrap-anywhere">
							{description}
						</SheetDescription>
					) : null}
					{note ? (
						<div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-xs">
							{note}
						</div>
					) : null}
				</div>

				{/*
				 * Actions and close travel together, so the record's own buttons can
				 * never end up underneath the close control.
				 */}
				<div className="flex shrink-0 items-center gap-1">
					{actions}
					{actions ? (
						<Separator orientation="vertical" className="mx-1 h-5" />
					) : null}
					<Button variant="ghost" size="icon-sm" onClick={onClose}>
						<Icon icon={Close} />
						<span className="sr-only">Close</span>
					</Button>
				</div>
			</div>
		</SheetHeader>
	);
}

/**
 * The numbers you would otherwise open a tab to find.
 *
 * Deliberately not the counts already printed on the tabs beside them — a
 * strip that repeats "Contacts 3" under a tab reading "Contacts 3" is a band
 * of furniture, not information.
 */
export function DetailSheetStats({ children }: { children: ReactNode }) {
	return <dl className="flex shrink-0 divide-x border-b">{children}</dl>;
}

export function DetailSheetStat({
	label,
	children,
}: {
	label: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className={cn("flex min-w-0 flex-1 flex-col gap-1 py-2.5", GUTTER)}>
			<dt className="truncate text-muted-foreground text-xs">{label}</dt>
			<dd className="min-w-0 truncate text-sm">{children}</dd>
		</div>
	);
}

export type DetailSheetTab = {
	value: string;
	label: string;
	/** Shown next to the label — omit rather than render a zero. */
	count?: number | null;
	content: ReactNode;
};

/**
 * The tabs inside a record sheet.
 *
 * The active tab is component state, not a URL param: the sheet's identity is
 * already in `?record=`, and putting the tab there too would mean every glance
 * at "Activity" is a history entry the back button has to walk through before
 * it closes the sheet.
 */
export function DetailSheetTabs({
	tabs,
	value,
	onValueChange,
}: {
	tabs: DetailSheetTab[];
	value: string;
	onValueChange: (value: string) => void;
}) {
	return (
		<Tabs
			value={value}
			onValueChange={onValueChange}
			className="flex min-h-0 flex-1 flex-col gap-0"
		>
			{/*
			 * Tabs only. A panel's actions live in the panel — a button bolted to
			 * the right of the tab strip reads as part of the navigation, and the
			 * one thing it is not is somewhere you can go.
			 */}
			<TabsList
				variant="line"
				className={cn("w-full shrink-0 justify-start gap-6 border-b", GUTTER)}
			>
				{tabs.map((tab) => (
					<TabsTrigger key={tab.value} value={tab.value}>
						{tab.label}
						{tab.count ? (
							<span className="text-muted-foreground tabular-nums">
								{tab.count}
							</span>
						) : null}
					</TabsTrigger>
				))}
			</TabsList>

			{/*
			 * The panel does not scroll — whatever is inside it does. A tab of
			 * sections wraps itself in `DetailSheetBody`; a tab that is one long
			 * table lets the table scroll under its own pinned header. Scrolling
			 * here as well would give both of those a second scrollbar.
			 */}
			{tabs.map((tab) => (
				<TabsContent
					key={tab.value}
					value={tab.value}
					className="flex min-h-0 flex-1 flex-col overflow-hidden outline-none"
				>
					{tab.content}
				</TabsContent>
			))}
		</Tabs>
	);
}

/** The scroll container for a tab made of sections rather than one table. */
export function DetailSheetBody({ children }: { children: ReactNode }) {
	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
			{children}
		</div>
	);
}

export function DetailSheetSection({
	title,
	action,
	className,
	children,
}: {
	title?: ReactNode;
	action?: ReactNode;
	className?: string;
	children: ReactNode;
}) {
	return (
		<section
			className={cn(
				"space-y-3 border-b py-4 last:border-b-0",
				GUTTER,
				className,
			)}
		>
			{title || action ? (
				<div className="flex h-6 items-center justify-between gap-3">
					{title ? <h3 className={SECTION_TITLE}>{title}</h3> : <span />}
					{action}
				</div>
			) : null}
			{children}
		</section>
	);
}

/**
 * Two columns of editable properties on a wide panel, one on a narrow one.
 *
 * Paired rather than a single list because a company has eight of these and a
 * single column turns the first screen of the sheet into a ladder you scroll.
 */
export function DetailSheetProperties({ children }: { children: ReactNode }) {
	return <div className="grid gap-x-8 sm:grid-cols-2">{children}</div>;
}

/**
 * Nothing here yet, said once, the same way everywhere.
 *
 * A real empty state rather than a line of grey text: an empty panel is the
 * most common thing a rep sees on a company they just added, so it is the one
 * place the app has to say what this list is for and how to start it.
 */
export function DetailSheetEmpty({
	icon,
	title,
	description,
	action,
}: {
	icon: CarbonIcon;
	title: string;
	description: string;
	action?: ReactNode;
}) {
	return (
		<Empty className="flex-1">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<Icon icon={icon} />
				</EmptyMedia>
				<EmptyTitle>{title}</EmptyTitle>
				<EmptyDescription>{description}</EmptyDescription>
			</EmptyHeader>
			{action ? <EmptyContent>{action}</EmptyContent> : null}
		</Empty>
	);
}
