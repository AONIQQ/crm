"use client";

import { cn } from "@crm/ui/lib/utils";
import type { ReactNode } from "react";
import { type RecordKind, useOpenRecord } from "./record-stack";

/**
 * A cross-reference to another record.
 *
 * A button rather than an anchor because there is nowhere to navigate to: the
 * record opens over whatever you are already looking at, and the URL it would
 * have pointed at is the one this sets.
 */
export function RecordLink({
	kind,
	id,
	className,
	children,
}: {
	kind: RecordKind;
	id: string;
	className?: string;
	children: ReactNode;
}) {
	const open = useOpenRecord();

	return (
		<button
			type="button"
			onClick={(event) => {
				// Rows and cards are clickable too; without this both fire and the
				// wrong record wins.
				event.stopPropagation();
				open({ kind, id });
			}}
			className={cn(
				"min-w-0 truncate text-left text-muted-foreground hover:text-foreground hover:underline",
				className,
			)}
		>
			{children}
		</button>
	);
}
