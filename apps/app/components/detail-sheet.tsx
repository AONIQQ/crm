"use client";

import type { SheetSize } from "@crm/ui/components/sheet";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@crm/ui/components/tabs";
import { cn } from "@crm/ui/lib/utils";
import type { ReactNode } from "react";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/responsive-sheet";

/**
 * The chrome every record sheet is built from.
 *
 * One shape for all of them — header, a strip of numbers, tabs, a scrolling
 * body — so a rep who has opened a company knows where everything is on a deal
 * without looking. The parts are separate components rather than props on one
 * because the tabs' contents differ per record and a `renderX` prop for each
 * would be worse than composing them.
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
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				side="right"
				size={size}
				className={cn("flex flex-col gap-0 p-0", className)}
			>
				{children}
			</SheetContent>
		</Sheet>
	);
}

export function DetailSheetHeader({
	eyebrow,
	title,
	description,
	media,
	actions,
	className,
	children,
}: {
	eyebrow?: ReactNode;
	title: ReactNode;
	description?: ReactNode;
	media?: ReactNode;
	/** Buttons, wrapped so the close control never lands on top of them. */
	actions?: ReactNode;
	className?: string;
	children?: ReactNode;
}) {
	return (
		<SheetHeader
			className={cn("gap-0 space-y-3 border-b p-5 pr-14", className)}
		>
			{eyebrow ? (
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
					{eyebrow}
				</div>
			) : null}

			<div className="flex items-start gap-4">
				{media}
				<div className="min-w-0 flex-1 space-y-1">
					<SheetTitle size="lg" className="wrap-anywhere">
						{title}
					</SheetTitle>
					{description ? (
						<SheetDescription className="wrap-anywhere">
							{description}
						</SheetDescription>
					) : null}
				</div>
			</div>

			{actions ? (
				<div className="flex flex-wrap items-center gap-2">{actions}</div>
			) : null}

			{children}
		</SheetHeader>
	);
}

/** A row of the four or five numbers you would otherwise go hunting for. */
export function DetailSheetStats({
	className,
	children,
}: {
	className?: string;
	children: ReactNode;
}) {
	return (
		<dl className={cn("flex shrink-0 divide-x border-b", className)}>
			{children}
		</dl>
	);
}

export function DetailSheetStat({
	label,
	className,
	children,
}: {
	label: ReactNode;
	className?: string;
	children: ReactNode;
}) {
	return (
		<div
			className={cn(
				"flex min-w-0 flex-1 flex-col gap-1.5 px-5 py-3",
				className,
			)}
		>
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
	className,
}: {
	tabs: DetailSheetTab[];
	value: string;
	onValueChange: (value: string) => void;
	className?: string;
}) {
	return (
		<Tabs
			value={value}
			onValueChange={onValueChange}
			className={cn("flex min-h-0 flex-1 flex-col gap-0", className)}
		>
			<TabsList
				variant="line"
				className="w-full shrink-0 justify-start gap-4 border-b px-5"
			>
				{tabs.map((tab) => (
					<TabsTrigger key={tab.value} value={tab.value}>
						{tab.label}
						{tab.count ? (
							<span className="tabular-nums opacity-60">{tab.count}</span>
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
export function DetailSheetBody({
	className,
	children,
}: {
	className?: string;
	children: ReactNode;
}) {
	return (
		<div
			className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto", className)}
		>
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
			className={cn("space-y-3 border-b p-5 last:border-b-0", className)}
		>
			{title || action ? (
				<div className="flex items-center justify-between gap-3">
					{title ? (
						<h3 className="font-medium text-foreground text-sm">{title}</h3>
					) : (
						<span />
					)}
					{action}
				</div>
			) : null}
			{children}
		</section>
	);
}

/** Nothing here yet, said once, the same way everywhere. */
export function DetailSheetEmpty({ children }: { children: ReactNode }) {
	return (
		<p className="px-5 py-10 text-center text-muted-foreground text-xs">
			{children}
		</p>
	);
}
