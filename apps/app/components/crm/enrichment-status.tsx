import type { EnrichmentStatus } from "@crm/db/enums";
import {
	StatusIndicator,
	type StatusTone,
} from "@crm/ui/components/status-indicator";

/**
 * How the agent is getting on with a record.
 *
 * `SKIPPED` is neutral, not an error: there was nothing to find (an unknown
 * domain, a free email host), and no credits were spent. `FAILED` is the one
 * worth chasing.
 *
 * `PENDING` is the awkward one, and it is why this takes a `queued` flag. It is
 * the column's *default*, so it is true of every record from the moment it is
 * inserted — it means "no research has run", which is not the same as "research
 * is about to run". Rendering it unconditionally as "Queued" told every rep
 * that all 62 unenriched records were in a queue that held 3.
 */
const PRESENTATION: Record<
	EnrichmentStatus,
	{ label: string; tone: StatusTone; busy?: boolean }
> = {
	PENDING: { label: "Not researched", tone: "neutral" },
	RUNNING: { label: "Researching", tone: "info", busy: true },
	COMPLETE: { label: "Enriched", tone: "success" },
	FAILED: { label: "Enrichment failed", tone: "error" },
	SKIPPED: { label: "Nothing found", tone: "neutral" },
};

/** What `PENDING` becomes when the agent really does have the record on its list. */
const QUEUED = { label: "Queued", tone: "neutral" as StatusTone, busy: false };

function present(status: EnrichmentStatus, queued: boolean) {
	return status === "PENDING" && queued ? QUEUED : PRESENTATION[status];
}

export function EnrichmentIndicator({
	status,
	/** Whether an unfinished agent task names this record. */
	queued = false,
	/** The error, when there is one — shown on hover rather than in the row. */
	title,
	className,
}: {
	status: EnrichmentStatus;
	queued?: boolean;
	title?: string | null;
	className?: string;
}) {
	const { label, tone, busy } = present(status, queued);

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
 *
 * `PENDING` alone is not enough to keep polling, and used to be: a contact
 * could never leave it, so every open contact sheet asked the server the same
 * question every three seconds until the tab was closed.
 */
export function isEnriching(status: EnrichmentStatus, queued = false): boolean {
	return status === "RUNNING" || (status === "PENDING" && queued);
}

/** How often to ask, in ms, while the agent is still working. */
export const ENRICHMENT_POLL_MS = 3_000;

/** Statuses in the order the facet dropdown should list them. */
export const ENRICHMENT_FACET_OPTIONS = (
	Object.keys(PRESENTATION) as EnrichmentStatus[]
).map((value) => ({ value, label: PRESENTATION[value].label }));
