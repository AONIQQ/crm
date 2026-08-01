import type { GoogleSyncStatus } from "@crm/db/enums";
import {
	StatusIndicator,
	type StatusTone,
} from "@crm/ui/components/status-indicator";

/**
 * How a mailbox sync is getting on.
 *
 * `NEEDS_RECONNECT` is deliberately not an error tone shared with `FAILED`:
 * a failure is ours to chase, a reconnect is the rep's to fix, and the settings
 * page needs to tell those apart at a glance.
 */
const PRESENTATION: Record<
	GoogleSyncStatus,
	{ label: string; tone: StatusTone; busy?: boolean }
> = {
	IDLE: { label: "Connected", tone: "success" },
	RUNNING: { label: "Syncing", tone: "info", busy: true },
	NEEDS_RECONNECT: { label: "Reconnect needed", tone: "warning" },
	FAILED: { label: "Sync failed", tone: "error" },
};

export function SyncIndicator({
	status,
	title,
	className,
}: {
	status: GoogleSyncStatus | null;
	title?: string | null;
	className?: string;
}) {
	if (status === null) {
		return (
			<StatusIndicator
				tone="neutral"
				label="Not connected"
				className={className}
			/>
		);
	}

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
 * A sync is background work no client action caused, so — exactly like
 * enrichment — there is nothing to invalidate and the only way to notice it
 * finished is to ask. One definition, so the settings page and the record sheet
 * cannot disagree about when to stop asking.
 */
export function isSyncing(status: GoogleSyncStatus | null): boolean {
	return status === "RUNNING";
}

/** How often to ask, in ms, while a sync is still working. */
export const SYNC_POLL_MS = 5_000;
