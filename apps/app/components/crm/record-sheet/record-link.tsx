"use client";

import ArrowLeft from "@carbon/icons-react/es/ArrowLeft";
import { Button } from "@crm/ui/components/button";
import { Icon } from "@crm/ui/components/icon";
import { cn } from "@crm/ui/lib/utils";
import type { ReactNode } from "react";
import { type RecordKind, useOpenRecord, useRecordStack } from "./record-stack";

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

/**
 * Back to the record you opened this one from.
 *
 * Only appears once there is somewhere to go back to — on the first record in
 * a trail the close button beside it already does the same job.
 */
export function RecordBack() {
	const { stack, close } = useRecordStack();

	if (stack.length < 2) return null;

	return (
		<Button variant="ghost" size="sm" onClick={close}>
			<Icon icon={ArrowLeft} data-icon="inline-start" />
			Back
		</Button>
	);
}
