"use client";

import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@crm/ui/components/accordion";
import { Skeleton } from "@crm/ui/components/skeleton";
import { ThreadMessage } from "@crm/ui/components/thread-message";
import { relativeTimeFromIso } from "@crm/ui/lib/format";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTRPC } from "@/lib/trpc/client";

const timeFormat = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
});

/**
 * A synced Gmail thread, collapsed to one line.
 *
 * The messages are fetched only when it is opened: the timeline payload carries
 * a snippet and a count, and email bodies are the one thing that must never
 * ride along on a list response.
 */
export function EmailThreadEntry({
	threadId,
	messageCount,
}: {
	threadId: string;
	messageCount: number;
}) {
	const trpc = useTRPC();
	const [opened, setOpened] = useState(false);

	const thread = useQuery({
		...trpc.google.thread.queryOptions({ threadId }),
		enabled: opened,
	});

	return (
		<Accordion
			type="single"
			collapsible
			onValueChange={(value) => {
				// Latched: collapsing again should not throw away what we fetched.
				if (value) setOpened(true);
			}}
		>
			<AccordionItem value={threadId} className="border-b-0">
				<AccordionTrigger className="py-1 text-muted-foreground text-xs">
					{messageCount === 1 ? "1 message" : `${messageCount} messages`}
				</AccordionTrigger>

				<AccordionContent>
					{thread.isPending ? (
						<div className="flex flex-col gap-2">
							<Skeleton className="h-4 w-1/3" />
							<Skeleton className="h-4 w-2/3" />
						</div>
					) : thread.isError ? (
						<p className="text-muted-foreground text-sm">
							{thread.error.message}
						</p>
					) : (
						<div className="flex flex-col">
							{thread.data?.messages.map((message) => (
								<ThreadMessage
									key={message.id}
									from={message.fromName ?? message.fromEmail}
									fromEmail={message.fromEmail}
									sentAt={timeFormat.format(new Date(message.sentAt))}
									direction={message.direction}
									body={message.body}
									action={
										message.gmailUrl ? (
											<a
												href={message.gmailUrl}
												target="_blank"
												rel="noreferrer"
												className="text-muted-foreground underline underline-offset-3 hover:text-foreground"
											>
												Open in Gmail
											</a>
										) : null
									}
								/>
							))}
						</div>
					)}
				</AccordionContent>
			</AccordionItem>
		</Accordion>
	);
}

/** "3 messages · latest 2h ago", for the collapsed row. */
export function threadSummary(
	messageCount: number,
	lastMessageAt: string,
): string {
	const count = messageCount === 1 ? "1 message" : `${messageCount} messages`;
	return `${count} · latest ${relativeTimeFromIso(lastMessageAt)}`;
}
