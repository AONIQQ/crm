import type { EnrichmentStatus } from "@crm/db/enums";
import {
	StatusIndicator,
	type StatusTone,
} from "@crm/ui/components/status-indicator";

/**
 * How the agent is getting on with a company.
 *
 * `SKIPPED` is neutral, not an error: there was nothing to find (an unknown
 * domain, a free email host), and no credits were spent. `FAILED` is the one
 * worth chasing.
 */
const PRESENTATION: Record<
	EnrichmentStatus,
	{ label: string; tone: StatusTone; busy?: boolean }
> = {
	PENDING: { label: "Queued", tone: "neutral" },
	RUNNING: { label: "Enriching", tone: "info", busy: true },
	COMPLETE: { label: "Enriched", tone: "success" },
	FAILED: { label: "Enrichment failed", tone: "error" },
	SKIPPED: { label: "Nothing found", tone: "neutral" },
};

export function EnrichmentIndicator({
	status,
	/** The error, when there is one — shown on hover rather than in the row. */
	title,
	className,
}: {
	status: EnrichmentStatus;
	title?: string | null;
	className?: string;
}) {
	const { label, tone, busy } = PRESENTATION[status];

	return (
		<StatusIndicator
			tone={tone}
			busy={busy}
			label={label}
			title={title ?? undefined}
			className={className}
		/>
	);
}

/**
 * Still going to change on its own.
 *
 * Enrichment is background work with no client action behind it, so there is
 * nothing to invalidate — the only way to notice it finished is to ask. Anything
 * rendering an enriched field (a logo, an industry) polls on this while it is
 * true and stops the moment it settles.
 */
export function isEnriching(status: EnrichmentStatus): boolean {
	return status === "PENDING" || status === "RUNNING";
}

/** How often to ask, in ms, while the agent is still working. */
export const ENRICHMENT_POLL_MS = 3_000;

/** Statuses in the order the facet dropdown should list them. */
export const ENRICHMENT_FACET_OPTIONS = (
	Object.keys(PRESENTATION) as EnrichmentStatus[]
).map((value) => ({ value, label: PRESENTATION[value].label }));
