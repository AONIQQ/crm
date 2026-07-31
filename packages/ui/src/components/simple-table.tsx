"use client";

import {
	Table,
	TableBody,
	TableHead,
	TableHeader,
	TableRow,
} from "@crm/ui/components/table";
import {
	ROW_ACCENT,
	ROW_ACCENT_EXPANDABLE,
} from "@crm/ui/lib/row-accent";
import { cn } from "@crm/ui/lib/utils";
import type { ComponentProps, ReactNode } from "react";

export type SimpleTableColumn = {
	header?: ReactNode;
	srLabel?: string;
	width?: string;
	align?: "left" | "right" | "center";
	className?: string;
};

const ALIGN_CLASS = {
	left: "",
	right: "text-right",
	center: "text-center",
} as const;

export function SimpleTable({
	columns,
	children,
	variant = "default",
	className,
	containerClassName,
	headerClassName,
	headerRowClassName,
	headerHeight,
}: {
	columns: SimpleTableColumn[];
	children: ReactNode;
	/**
	 * `panel` fills the remaining height of a sheet tab and pins the header
	 * while the rows scroll under it. Everywhere else the table is one block in
	 * a column of blocks and scrolls with the page.
	 */
	variant?: "default" | "panel";
	className?: string;
	containerClassName?: string;
	headerClassName?: string;
	headerRowClassName?: string;
	headerHeight?: string;
}) {
	const panel = variant === "panel";

	return (
		<Table
			className={cn("w-full", panel && "table-fixed", className)}
			containerClassName={cn(
				panel && "min-h-0 flex-1 overflow-x-hidden overflow-y-auto",
				containerClassName,
			)}
		>
			<TableHeader
				className={cn(
					panel && "sticky top-0 z-10 bg-popover [&_th]:bg-popover",
					headerClassName,
				)}
			>
				<TableRow className={cn("hover:bg-transparent", headerRowClassName)}>
					{columns.map((column, index) => (
						<TableHead
							key={index}
							aria-label={column.header ? undefined : column.srLabel}
							className={cn(
								headerHeight ?? (panel ? "h-9" : "h-11"),
								"px-3 font-normal text-muted-foreground",
								column.width,
								ALIGN_CLASS[column.align ?? "left"],
								column.className,
							)}
						>
							{column.header}
						</TableHead>
					))}
				</TableRow>
			</TableHeader>
			<TableBody>{children}</TableBody>
		</Table>
	);
}

export function SimpleTableRow({
	clickable,
	expandable,
	className,
	...props
}: ComponentProps<typeof TableRow> & {
	clickable?: boolean;
	expandable?: boolean;
}) {
	return (
		<TableRow
			className={cn(
				"hover:bg-transparent",
				clickable && (expandable ? ROW_ACCENT_EXPANDABLE : ROW_ACCENT),
				className,
			)}
			{...props}
		/>
	);
}
