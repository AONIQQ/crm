import { Avatar, AvatarFallback } from "@crm/ui/components/avatar";
import { cn } from "@crm/ui/lib/utils";
import type * as React from "react";

/**
 * One message in an email thread.
 *
 * Direction is carried by a rail down the left rather than by colour: a mail
 * client's blue-for-mine is a convention this design system does not have, and
 * a rail reads the same in both themes and to anyone who cannot see the hue.
 */
function ThreadMessage({
	from,
	fromEmail,
	sentAt,
	direction,
	body,
	action,
	className,
	...props
}: Omit<React.ComponentProps<"article">, "children"> & {
	from: string;
	fromEmail: string;
	/** Already formatted — the package does not own locale decisions. */
	sentAt: string;
	direction: "INBOUND" | "OUTBOUND";
	body: string | null;
	/** A deep link back to Gmail, usually. */
	action?: React.ReactNode;
}) {
	const outbound = direction === "OUTBOUND";

	return (
		<article
			data-slot="thread-message"
			data-direction={direction}
			className={cn(
				"flex gap-2.5 border-l-2 py-2 pl-3",
				outbound ? "border-l-foreground/30" : "border-l-border",
				className,
			)}
			{...props}
		>
			<Avatar size="sm" className="mt-0.5">
				<AvatarFallback>{initialsOf(from, fromEmail)}</AvatarFallback>
			</Avatar>

			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
					<span className="font-medium text-xs">{from}</span>
					<span className="truncate text-muted-foreground text-xs">
						{fromEmail}
					</span>
					<span className="ml-auto text-muted-foreground text-xs">
						{sentAt}
					</span>
				</div>

				{body ? (
					<p className="whitespace-pre-wrap text-pretty text-muted-foreground text-xs/5">
						{body}
					</p>
				) : (
					<p className="text-muted-foreground text-xs italic">
						No message body.
					</p>
				)}

				{action ? <div className="flex gap-3 text-xs">{action}</div> : null}
			</div>
		</article>
	);
}

/** Up to two letters, from the display name if there is one. */
function initialsOf(name: string, email: string): string {
	const source = name.trim() && !name.includes("@") ? name : email;
	const words = source.split(/[\s._-]+/).filter(Boolean);

	return words
		.slice(0, 2)
		.map((word) => word.charAt(0).toUpperCase())
		.join("");
}

export { ThreadMessage };
