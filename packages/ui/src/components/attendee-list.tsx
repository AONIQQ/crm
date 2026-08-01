import { Avatar, AvatarFallback } from "@crm/ui/components/avatar";
import {
	type StatusTone,
	StatusIndicator,
} from "@crm/ui/components/status-indicator";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@crm/ui/components/tooltip";
import { cn } from "@crm/ui/lib/utils";
import type * as React from "react";

export type Attendee = {
	id: string;
	email: string;
	name: string | null;
	/** Google's own values: needsAction | declined | tentative | accepted. */
	responseStatus: string | null;
	isOrganizer: boolean;
};

/**
 * Whether someone actually turned up to the invitation.
 *
 * Mapped onto the shared tones rather than to colours directly, so a declined
 * attendee reads the same red as a lost deal.
 */
const RESPONSE_TONE: Record<string, StatusTone> = {
	accepted: "success",
	declined: "error",
	tentative: "warning",
	needsAction: "neutral",
};

const RESPONSE_LABEL: Record<string, string> = {
	accepted: "Accepted",
	declined: "Declined",
	tentative: "Maybe",
	needsAction: "No reply",
};

/**
 * The people on a meeting, up to `max`, then a count. The full list is in the
 * tooltip because a nine-person kickoff should not push the timeline entry to
 * three lines.
 *
 * Side by side rather than the usual overlapping stack, and that is a fix, not
 * a preference. A stack needs a ring the colour of whatever is behind it to cut
 * each disc from the next — so the component had to name a surface, it named
 * `background`, and it is only ever rendered on `popover`, which drew a dark
 * halo round every face. The overlap also ate the second initial: two letters
 * in a 24px disc, eight of those pixels underneath the next avatar.
 */
function AttendeeList({
	attendees,
	max = 5,
	className,
	...props
}: Omit<React.ComponentProps<"div">, "children"> & {
	attendees: readonly Attendee[];
	max?: number;
}) {
	if (attendees.length === 0) return null;

	const shown = attendees.slice(0, max);
	const overflow = attendees.length - shown.length;

	return (
		<div
			data-slot="attendee-list"
			className={cn("flex items-center gap-2", className)}
			{...props}
		>
			<div className="flex items-center gap-1">
				{shown.map((attendee) => (
					<Tooltip key={attendee.id}>
						<TooltipTrigger asChild>
							<Avatar size="sm">
								<AvatarFallback>{initialsOf(attendee)}</AvatarFallback>
							</Avatar>
						</TooltipTrigger>
						<TooltipContent>
							<span className="flex items-center gap-2">
								{attendee.name ?? attendee.email}
								<StatusIndicator
									tone={RESPONSE_TONE[attendee.responseStatus ?? "needsAction"] ?? "neutral"}
									label={
										RESPONSE_LABEL[attendee.responseStatus ?? "needsAction"] ??
										"No reply"
									}
								/>
							</span>
						</TooltipContent>
					</Tooltip>
				))}
			</div>

			{overflow > 0 ? (
				<span className="text-muted-foreground text-xs">+{overflow}</span>
			) : null}
		</div>
	);
}

function initialsOf(attendee: Attendee): string {
	const source =
		attendee.name?.trim() && !attendee.name.includes("@")
			? attendee.name
			: attendee.email;

	return source
		.split(/[\s._-]+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((word) => word.charAt(0).toUpperCase())
		.join("");
}

export { AttendeeList };
