"use client";

import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@crm/ui/components/tooltip";
import type * as React from "react";

/**
 * The decoration on a value a machine wrote.
 *
 * One dotted underline, for the same reason `status-indicator` is a dot and a
 * word rather than a badge: a sheet speckled with chips is a sheet you read the
 * chips of. An underline says "there is more here" at a tenth of the ink and
 * vanishes when you are not looking for it.
 *
 * Exported as a class rather than a component because it has to sit on the text
 * *inside* whatever control already owns the row — wrapping the control would
 * either nest a button in a button or steal its focus behaviour.
 */
export const SOURCED_VALUE = "underline decoration-dotted underline-offset-4";

/**
 * Hangs provenance off an existing control.
 *
 * `children` must be a single focusable element — the field's own button,
 * normally — so that pointing at a value explains it and tabbing to it does the
 * same. Nothing new becomes clickable.
 *
 * **Not a fragment.** `asChild` clones the child to pass `aria-describedby` and
 * the tooltip's open state onto it, and a fragment takes no props: React throws
 * `Invalid prop \`aria-describedby\` supplied to \`React.Fragment\``. The type
 * cannot catch this — a fragment is a perfectly good `ReactElement` — so it is
 * written down here instead.
 */
export function SourcedValue({
	children,
	source,
}: {
	children: React.ReactElement;
	source: React.ReactNode;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent className="block max-w-sm px-3 py-2 text-left">
				{source}
			</TooltipContent>
		</Tooltip>
	);
}

/**
 * The body of a provenance tooltip: what we believe, why, and since when.
 *
 * Prose rather than a field table. "LinkedIn: employer and name both match" is
 * something a rep can act on; `score: 0.85, method: linkedin.profile` is
 * something they have to decode first, and a tooltip is not a place anybody
 * wants to decode anything.
 */
export function Provenance({
	claim,
	reasons,
	observedAt,
	sourceUrl,
}: {
	claim: string;
	reasons: string[];
	observedAt?: string;
	sourceUrl?: string | null;
}) {
	return (
		<span className="flex flex-col gap-1.5">
			<span className="font-medium">{claim}</span>

			{reasons.length > 0 ? (
				<span className="flex flex-col gap-0.5 opacity-80">
					{reasons.map((reason) => (
						<span key={reason}>{reason}</span>
					))}
				</span>
			) : null}

			{observedAt || sourceUrl ? (
				<span className="flex flex-wrap items-center gap-x-2 opacity-60">
					{observedAt ? <span>{observedAt}</span> : null}
					{sourceUrl ? (
						<span className="truncate">{hostOf(sourceUrl)}</span>
					) : null}
				</span>
			) : null}
		</span>
	);
}

function hostOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}
