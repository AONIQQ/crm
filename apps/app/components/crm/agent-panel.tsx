"use client";

import Send from "@carbon/icons-react/es/Send";
import { Button } from "@crm/ui/components/button";
import { Icon } from "@crm/ui/components/icon";
import { Input } from "@crm/ui/components/input";
import { Spinner } from "@crm/ui/components/spinner";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { type EveMessage, type EveMessagePart, useEveAgent } from "eve/react";
import { useState } from "react";

/**
 * The agent, on the record, while it works.
 *
 * The thing neither HubSpot nor Salesforce puts in front of a rep: not a
 * chatbot in a corner, but *this* agent working on *this* person, with its
 * steps visible and its questions answerable. Watching it reject
 * `github.com/lewis` because the account is named Lewis Delicata is what makes
 * the fields it did fill in believable.
 *
 * It talks to `/eve/v1/*` on this origin, which the app proxies to the agent
 * after checking the session — so the hook needs no host, no key, and no
 * knowledge that the agent is a separate deployment.
 */
export function AgentPanel({
	contactId,
	contactName,
}: {
	contactId: string;
	contactName: string;
}) {
	const agent = useEveAgent();
	const [draft, setDraft] = useState("");

	const busy = agent.status === "submitted" || agent.status === "streaming";
	const steps = agent.data.messages.flatMap(toSteps);
	const question = pendingQuestion(agent.data.messages);

	const ask = (message: string) => {
		if (!message.trim() || busy) return;
		setDraft("");
		void agent.send({
			// The agent has no idea which record the rep is looking at, so the
			// question carries it. Everything else it needs it can read.
			message: `About contact ${contactId} (${contactName}): ${message.trim()}`,
		});
	};

	return (
		<div className="space-y-3">
			{steps.length === 0 && !busy ? (
				<p className="text-muted-foreground text-sm/6">
					Nothing running. Ask a question and you will see each step it takes —
					including the leads it throws away.
				</p>
			) : null}

			{steps.length > 0 ? (
				<ol className="space-y-1.5">
					{steps.map((step) => (
						<li key={step.id} className="flex items-start gap-2 text-sm">
							<StatusIndicator
								tone={step.tone}
								busy={step.pending}
								label={step.label}
							/>
						</li>
					))}
				</ol>
			) : null}

			{agent.error ? (
				<p className="text-destructive text-sm">{agent.error.message}</p>
			) : null}

			{/*
			 * The agent's own question, answered in place. This is the case the
			 * whole panel earns its keep on: four Bighams work at HubSpot, and the
			 * person looking at the record knows which one.
			 */}
			{question ? (
				<div className="space-y-2 border p-3">
					<p className="text-sm">{question.prompt}</p>
					{/*
					 * `options` is optional: a freeform question has none, and the
					 * composer below is how that one gets answered.
					 */}
					<div className="flex flex-wrap gap-2">
						{(question.options ?? []).map((option) => (
							<Button
								key={option.id}
								variant="outline"
								size="sm"
								onClick={() =>
									void agent.send({
										inputResponses: [
											{
												requestId: question.requestId,
												optionId: option.id,
											},
										],
									})
								}
							>
								{option.label}
							</Button>
						))}
					</div>
				</div>
			) : null}

			<form
				className="flex items-center gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					ask(draft);
				}}
			>
				<Input
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					placeholder="Is he still at Fleetio?"
					disabled={busy}
				/>
				<Button type="submit" size="icon-sm" variant="outline" disabled={busy}>
					{busy ? <Spinner /> : <Icon icon={Send} />}
					<span className="sr-only">Ask</span>
				</Button>
			</form>
		</div>
	);
}

type Step = {
	id: string;
	label: string;
	tone: "neutral" | "success" | "warning" | "info";
	pending: boolean;
};

/**
 * The wire events, as a list a rep can read.
 *
 * Tool calls become steps and assistant prose becomes a step, because the
 * useful reading of a research run is "what did it do", not "what did it say".
 * A tool that returned `written: false` is rendered as a *warning*, not hidden:
 * the refusals are the most trust-building thing on the page.
 */
function toSteps(message: EveMessage): Step[] {
	return message.parts.flatMap((part, index) => {
		const id = `${message.id}:${index}`;

		if (part.type === "text" && message.role === "assistant") {
			const text = part.text.trim();
			return text
				? [{ id, label: text, tone: "neutral" as const, pending: false }]
				: [];
		}

		if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
			const tool = toolName(part);
			const state = "state" in part ? part.state : undefined;
			const pending =
				state === "input-streaming" || state === "input-available";

			return [
				{
					id,
					label: describe(tool, part),
					tone: outcomeTone(part),
					pending,
				},
			];
		}

		return [];
	});
}

function toolName(part: EveMessagePart): string {
	if (part.type === "dynamic-tool" && "toolName" in part) {
		return String(part.toolName);
	}
	return part.type.replace(/^tool-/, "");
}

/** Tool slugs are for the model; this line is for a person. */
const VERBS: Record<string, string> = {
	read_crm_history: "Read our emails and meetings with them",
	resolve_linkedin_profile: "Searched for their LinkedIn profile",
	get_linkedin_profile: "Read a LinkedIn profile",
	get_contact_work_history: "Read their work history",
	find_contact_socials: "Searched for their other profiles",
	set_contact_socials: "Checked a profile against the account itself",
	identify_contact: "Put a name to the address",
	record_fact: "Recorded what it found",
	write_brief: "Wrote the background",
	research_person: "Researched them on the web",
	research_company: "Read the company's site",
	enrich_company: "Looked up the company",
	schedule_recheck: "Decided when to look again",
	record_job_change: "Raised a job change",
	list_outstanding_work: "Looked for outstanding work",
};

function describe(tool: string, part: EveMessagePart): string {
	const verb = VERBS[tool] ?? tool.replace(/_/g, " ");
	const output =
		"output" in part ? (part.output as Record<string, unknown>) : null;

	// The reason a write did not happen is the interesting half.
	const reason =
		output && typeof output.reason === "string" ? output.reason : null;
	return reason ? `${verb} — ${reason}` : verb;
}

function outcomeTone(part: EveMessagePart): Step["tone"] {
	if ("state" in part && part.state === "output-error") return "warning";

	const output =
		"output" in part ? (part.output as Record<string, unknown>) : null;
	if (!output) return "info";

	if (output.applied === true || output.written === true) return "success";
	if (output.stored === false || output.written === false) return "warning";

	return "info";
}

/**
 * A question the agent is parked on, if there is one.
 *
 * Only the latest message is inspected: an older request has either been
 * answered or superseded, and re-rendering a stale prompt invites somebody to
 * answer a question nobody is waiting on.
 */
function pendingQuestion(messages: readonly EveMessage[]) {
	for (const part of messages.at(-1)?.parts ?? []) {
		if (part.type !== "dynamic-tool") continue;

		const request = part.toolMetadata?.eve?.inputRequest;
		if (request) return request;
	}

	return null;
}
