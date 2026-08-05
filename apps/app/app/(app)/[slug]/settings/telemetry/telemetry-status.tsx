"use client";

import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { relativeTimeFromIso } from "@crm/ui/lib/format";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc/client";

const SENT = [
	"A single daily count of what exists: how many contacts, companies, deals and activities, in bands rather than exact numbers.",
	"Which of the agent's tools were called and how often, how many research sessions finished, and how many gave up.",
	"How the evidence ledger behaved: how many facts were applied, proposed or dismissed, and how long suggestions waited for a decision.",
	"Which optional keys are set — yes or no, never the values — the model you chose, your Node and Postgres versions, and this install's version.",
	"When something failed: the error's class and the tool or route it came from.",
];

const NEVER_SENT = [
	"Any name, email address, job title or photograph, of a contact or of you.",
	"Any company name, domain, industry or location.",
	"The content of a fact, a brief, a workspace profile, or anything the agent wrote about a person.",
	"Email subjects and bodies, meeting titles, attendees, deal names and deal amounts.",
	"Any prompt, completion, reasoning trace or agent conversation.",
	"Any key, secret, token or connection string — and your IP address, which is discarded rather than recorded.",
];

function List({ items }: { items: readonly string[] }) {
	return (
		<ul className="flex list-disc flex-col gap-2 pl-4 text-muted-foreground text-sm">
			{items.map((item) => (
				<li key={item}>{item}</li>
			))}
		</ul>
	);
}

export function TelemetryStatus() {
	const trpc = useTRPC();
	const status = useQuery(trpc.telemetry.status.queryOptions());

	const enabled = status.data?.enabled ?? false;

	return (
		<div className="flex flex-col gap-6">
			<Card>
				<CardHeader>
					<CardTitle>Anonymous usage telemetry</CardTitle>
					<CardDescription>
						This repository is cloned rather than installed, so there is no
						other way to know which parts of it earn their place. Counts only,
						once a day, tied to a random identifier and nothing else.
					</CardDescription>

					<CardAction>
						<StatusIndicator
							size="sm"
							tone={enabled ? "success" : "neutral"}
							label={enabled ? "On" : "Off"}
						/>
					</CardAction>
				</CardHeader>

				<CardContent className="flex flex-col gap-4">
					<dl className="grid gap-3 text-sm sm:grid-cols-3">
						<div className="flex flex-col gap-1">
							<dt className="text-muted-foreground text-xs">Install ID</dt>
							<dd className="font-mono text-xs">
								{status.data?.installId ?? "—"}
							</dd>
						</div>

						<div className="flex flex-col gap-1">
							<dt className="text-muted-foreground text-xs">Version</dt>
							<dd className="font-mono text-xs">
								{status.data?.crmVersion ?? "—"}
							</dd>
						</div>

						<div className="flex flex-col gap-1">
							<dt className="text-muted-foreground text-xs">Last sent</dt>
							<dd className="text-xs">
								{status.data?.lastSentAt
									? relativeTimeFromIso(status.data.lastSentAt)
									: "Never"}
							</dd>
						</div>
					</dl>

					<p className="text-muted-foreground text-sm">
						To turn it off, set{" "}
						<code className="font-mono text-xs">CRM_TELEMETRY_DISABLED=1</code>{" "}
						in the root <code className="font-mono text-xs">.env</code> file and
						restart. <code className="font-mono text-xs">DO_NOT_TRACK=1</code>{" "}
						does the same. Nothing is sent while either is set, and no client is
						left running to send it later.
					</p>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>What is sent</CardTitle>
					<CardDescription>
						Every property is on a list in the source, and anything not on that
						list is dropped before the event is built.
					</CardDescription>
				</CardHeader>

				<CardContent>
					<List items={SENT} />
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>What is never sent</CardTitle>
					<CardDescription>
						None of this leaves your database, whether telemetry is on or off.
					</CardDescription>
				</CardHeader>

				<CardContent>
					<List items={NEVER_SENT} />
				</CardContent>
			</Card>
		</div>
	);
}
