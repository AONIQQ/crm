"use client";

import { cn } from "@crm/ui/lib/utils";
import Link from "next/link";
import { useState } from "react";
import { BentoCard, CardHeading } from "./bento-card";
import { SendArrow } from "./send-arrow";

const QUESTIONS = [
	"What do they do?",
	"Who do we know here?",
	"What has changed recently?",
];

const PLACEHOLDER = "What do they sell?";

/**
 * The one card a reader can actually drive. Picking a question loads it into
 * the composer, and sending it is the sign-in — the answer needs a record, and
 * a record needs an account.
 */
export function AskCard() {
	const [asked, setAsked] = useState<string | null>(null);

	return (
		<BentoCard className="grow gap-6">
			<CardHeading
				title="Ask any record a question"
				body="It reads their site and our own history with them, and shows its working."
			/>

			<div className="flex grow flex-col justify-end gap-2.5">
				<p className="select-none font-medium text-[#5A5A5A] text-[11px]/4">
					SUGGESTED
				</p>
				{QUESTIONS.map((question) => (
					<button
						key={question}
						type="button"
						aria-pressed={asked === question}
						onClick={() => setAsked(question)}
						className={cn(
							"flex h-[38px] shrink-0 cursor-pointer select-none items-center rounded-md px-3 text-left text-[13px]/[18px] transition-colors",
							asked === question
								? "bg-accent text-foreground"
								: "bg-muted hover:bg-accent",
						)}
					>
						{question}
					</button>
				))}
			</div>

			<div className="flex h-11 shrink-0 items-center gap-2.5 rounded-md border border-border bg-[#1A1A1A] pr-1.5 pl-3.5 transition-colors focus-within:border-ring">
				<span
					className={cn(
						"min-w-0 grow truncate text-[13px]/[18px]",
						asked ? "text-foreground" : "text-[#6E6E6E]",
					)}
				>
					{asked ?? PLACEHOLDER}
				</span>
				<Link
					href="/sign-in"
					aria-label="Ask this question in the CRM"
					className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-primary transition-transform hover:scale-105 active:scale-95"
				>
					<SendArrow className="size-3.5 text-primary-foreground" />
				</Link>
			</div>
		</BentoCard>
	);
}
