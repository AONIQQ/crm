"use client";

import Checkmark from "@carbon/icons-react/es/Checkmark";
import CircleDash from "@carbon/icons-react/es/CircleDash";
import Document from "@carbon/icons-react/es/Document";
import LogoGithub from "@carbon/icons-react/es/LogoGithub";
import LogoLinkedin from "@carbon/icons-react/es/LogoLinkedin";
import Send from "@carbon/icons-react/es/Send";
import Warning from "@carbon/icons-react/es/Warning";
import {
	Attachment,
	AttachmentContent,
	AttachmentGroup,
	AttachmentMedia,
	AttachmentTitle,
	AttachmentTrigger,
} from "@crm/ui/components/attachment";
import { Bubble, BubbleContent } from "@crm/ui/components/bubble";
import { Button } from "@crm/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@crm/ui/components/empty";
import { type CarbonIcon, Icon } from "@crm/ui/components/icon";
import { Input } from "@crm/ui/components/input";
import Logo from "@crm/ui/components/logo";
import { Markdown } from "@crm/ui/components/markdown";
import { Marker, MarkerContent, MarkerIcon } from "@crm/ui/components/marker";
import {
	Message,
	MessageAvatar,
	MessageContent,
} from "@crm/ui/components/message";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@crm/ui/components/message-scroller";
import { Spinner } from "@crm/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEveAgent } from "eve/react";
import { useEffect, useRef, useState } from "react";
import {
	type Conversation,
	ConversationPicker,
	useConversations,
} from "@/components/crm/agent-conversations";
import {
	type AgentRecord,
	recordCopy,
	recordFilter,
	recordHeader,
} from "@/lib/agent-record";
import { type ResumeState, readResumeState } from "@/lib/agent-resume";
import {
	NEW_THREAD,
	pendingQuestion,
	resolveThread,
	type Source,
	type Tone,
	type TranscriptItem,
	toTranscript,
} from "@/lib/agent-transcript";
import { useTRPC } from "@/lib/trpc/client";
import { useRecordSheetView } from "./record-sheet/record-stack";

/**
 * The agent, on the record, while it works.
 *
 * The thing neither HubSpot nor Salesforce puts in front of a rep: not a
 * chatbot in a corner, but *this* agent working on *this* person, with its
 * steps visible and its questions answerable. Watching it reject a GitHub
 * account because that account is named somebody else is what makes the fields
 * it did fill in believable.
 *
 * Two choices carry the layout:
 *
 * - **The transcript is a `MessageScroller`,** which is doing more than it
 *   looks. It follows streamed output only while the reader is already at the
 *   bottom, so scrolling up to re-read a rejection does not get yanked away by
 *   the next tool call. That behaviour is most of the reason to use it rather
 *   than a `div`.
 * - **Tool calls are `Marker`s, not bubbles.** A bubble is something somebody
 *   said; "read a LinkedIn profile" is something that happened. Rendering the
 *   two differently is what makes a run skimmable — the eye can find three
 *   sentences of prose among thirty steps.
 */
/**
 * One record's panel, including which conversation is open.
 *
 * Which thread you are in lives in the URL (`?thread=`), like every other view
 * state in this sheet — so a refresh keeps your place and a conversation is a
 * link you can send someone. It is cleared when the record or the tab changes,
 * by the same rule that drops a half-typed quick-add form.
 *
 * **Nothing mounts until the list has loaded.** Rendering a thread while the
 * history is still in flight starts a *new* eve session, and the panel then
 * remounts onto the real one the moment the list arrives — which looked like
 * "the history only appears if I refresh or press something", because a second
 * visit had the list cached and got it right.
 */
export function AgentPanel({ record }: { record: AgentRecord }) {
	const conversations = useConversations(recordFilter(record));
	const { thread, setThread } = useRecordSheetView("overview");

	const history = conversations.data ?? [];

	/**
	 * Which conversation this panel opened on.
	 *
	 * Captured once, and deliberately not recomputed. Sending the first message
	 * in a new thread adds a row to the list, and re-deriving "the latest one"
	 * from that would change the `key` and remount the thread mid-answer — the
	 * transcript would blink away while the agent was still talking.
	 */
	const landedOn = useRef<string | null>(null);
	if (landedOn.current === null && conversations.isSuccess) {
		landedOn.current = history[0]?.id ?? NEW_THREAD;
	}

	const { openId, current } = resolveThread({
		conversations: history,
		fromUrl: thread,
		landedOn: landedOn.current,
	});

	if (conversations.isPending) return <Loading />;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<ConversationPicker
				conversations={history}
				current={current}
				onSelect={(conversation) => setThread(conversation.id)}
				onNew={() => setThread(NEW_THREAD)}
				busy={false}
			/>

			<ThreadWithHistory
				// The selection, not the resolved row: the row gains a timestamp and
				// a message count as the conversation goes on, and none of that
				// should tear the session down.
				key={openId ?? NEW_THREAD}
				record={record}
				conversation={current}
			/>
		</div>
	);
}

/**
 * Loads a reopened thread's transcript before mounting it.
 *
 * `initialSession` seeds the session *identity and cursor* — it does not fetch
 * anything. Without `initialEvents` beside it the panel resumed the right
 * conversation and rendered it empty, which read as "my history is gone" while
 * the picker above it showed the thread's own title.
 *
 * The events come from our own `AgentEvent` rows rather than eve's stream:
 * they outlive the 30-day session retention, and reading a month-old thread
 * should not wake the research runtime.
 */
function ThreadWithHistory({
	record,
	conversation,
}: {
	record: AgentRecord;
	conversation: Conversation | null;
}) {
	const trpc = useTRPC();

	/**
	 * Where the session actually got to, asked of the agent rather than the
	 * database.
	 *
	 * A stored continuation token goes stale as soon as a turn finishes with
	 * this panel unmounted, and eve rejects a stale one — so sending did
	 * nothing, silently. This reads the live tail instead.
	 */
	const resume = useQuery({
		queryKey: ["agent-resume", conversation?.sessionId],
		enabled: conversation !== null,
		staleTime: 0,
		refetchOnMount: "always",
		refetchOnWindowFocus: false,
		queryFn: ({ signal }) =>
			readResumeState(
				conversation?.sessionId ?? "",
				recordHeader(record),
				signal,
			),
	});

	const history = useQuery({
		...trpc.conversations.events.queryOptions({ id: conversation?.id ?? "" }),
		enabled: conversation !== null,
		// **Always refetch on mount.**
		//
		// Switching tabs unmounts this panel and tears the live stream down with
		// it; coming back rebuilds the transcript from here. Cached, that rebuild
		// is the transcript as it stood *before* the last answer — which looked
		// like "the newest reply is missing until I reload the page", because a
		// reload was the only thing clearing the cache.
		//
		// The events keep arriving in the database while the panel is away, so
		// what is on screen after a tab switch is only ever as fresh as this
		// fetch. It is one indexed read of a few hundred rows.
		staleTime: 0,
		refetchOnMount: "always",
		// Not on focus, though: clicking back into the window mid-answer would
		// refetch a transcript the live stream is already ahead of.
		refetchOnWindowFocus: false,
	});

	// Same rule as the list: mounting before the events arrive would build the
	// projection from nothing and then be unable to add them.
	// Only the transcript gates the mount. Whether the session will accept a
	// message is a question about the composer, and holding the whole panel on
	// a network read of a *streaming* endpoint is how a spinner becomes
	// permanent.
	if (conversation && history.isPending) return <Loading />;

	return (
		<Thread
			record={record}
			conversation={conversation}
			initialEvents={history.data}
			resume={resume.isPending ? { status: "checking" } : resume.data}
		/>
	);
}

function Loading() {
	return (
		<div className="flex flex-1 items-center justify-center">
			<Spinner />
		</div>
	);
}

function Thread({
	record,
	conversation,
	initialEvents,
	resume,
}: {
	record: AgentRecord;
	conversation: Conversation | null;
	initialEvents: unknown[] | undefined;
	resume: ResumeState | undefined;
}) {
	const copy = recordCopy(record.kind);
	// The record travels in a header, which the proxy turns into a token claim
	// and the agent reads at `session.started`. Deliberately not in the message:
	// a rep's question should read as their question, not as
	// "About contact cmsai6u77… (…): Hey!".
	const agent = useEveAgent({
		headers: recordHeader(record),
		// Resumes the durable session rather than starting another one. eve keeps
		// sessions for 30 days, so last week's thread is still live.
		//
		// `streamIndex: 0` deliberately, not the saved cursor: reopening a thread
		// should show what was said in it, and the cursor is where the *last
		// reader* stopped. Replaying from the start is what fills the transcript;
		// the saved index is only useful to a client that never unmounted.
		...(conversation
			? {
					initialSession: {
						sessionId: conversation.sessionId,
						// The recovered token wins over the stored one, which is only
						// as fresh as the last turn this panel watched finish.
						continuationToken:
							resume?.status === "waiting"
								? resume.continuationToken
								: (conversation.continuationToken ?? undefined),
						// Where the stream should carry on from. The transcript itself
						// comes from `initialEvents`, so this is the tail we have
						// already seen rather than a request to replay.
						streamIndex: initialEvents?.length ?? 0,
					},
					initialEvents: (initialEvents ?? []) as NonNullable<
						Parameters<typeof useEveAgent>[0]
					>["initialEvents"],
				}
			: {}),
	});
	const [draft, setDraft] = useState("");

	// Remembers the opening question so the thread has a name in the picker.
	const opening = useRef<string | null>(conversation?.title ?? null);

	useSavedConversation({
		record: recordFilter(record),
		conversation,
		opening,
		session: agent.session ?? null,
		messages: agent.data.messages.length,
	});

	const busy = agent.status === "submitted" || agent.status === "streaming";
	const messages = toTranscript(agent.data.messages);
	const question = pendingQuestion(agent.data.messages);

	// A session that is mid-turn cannot take input, so the composer says so
	// rather than swallowing it.
	const locked =
		busy || resume?.status === "busy" || resume?.status === "checking";

	const ask = (message: string) => {
		if (!message.trim() || locked) return;
		opening.current ||= message.trim();
		setDraft("");
		void agent.send({ message: message.trim() });
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{/*
			 * `autoScroll` and nothing else, deliberately.
			 *
			 * The scroller is a state machine — `following-bottom`,
			 * `free-scrolling`, `anchored-to-message` — and `scrollAnchor` selects
			 * the third. Anchoring a turn to the top of the viewport is the
			 * ChatGPT behaviour, and it *stops the scroller following the bottom*:
			 * the answer then streams below the fold while the two modes fight over
			 * each new row, which is what the flicker was.
			 *
			 * Left alone, `autoScroll` does exactly what is wanted here: it keeps
			 * the tail in view while the reader is at the bottom, and releases to
			 * `free-scrolling` the moment they scroll away — so a reply that arrives
			 * while you are reading something further up leaves you where you are
			 * and lights the jump-to-end button instead.
			 */}
			<MessageScrollerProvider autoScroll defaultScrollPosition="end">
				<MessageScroller className="flex-1">
					<MessageScrollerViewport>
						<MessageScrollerContent className="gap-3 px-5 py-4">
							{messages.length === 0 && !busy ? (
								<Idle kind={record.kind} onAsk={ask} />
							) : null}

							{/*
							 * One row per message, which is the boundary the scroller
							 * measures. A row per tool call would have it re-measuring
							 * dozens of new boundaries inside a single answer.
							 */}
							{messages.map((message) => (
								<MessageScrollerItem key={message.id} messageId={message.id}>
									<div className="space-y-3">
										{message.items.map((item) => (
											<Item key={item.id} item={item} />
										))}
									</div>
								</MessageScrollerItem>
							))}

							{question ? (
								<MessageScrollerItem messageId={question.requestId}>
									<Question question={question} agent={agent} />
								</MessageScrollerItem>
							) : null}
						</MessageScrollerContent>
					</MessageScrollerViewport>

					<MessageScrollerButton />
				</MessageScroller>
			</MessageScrollerProvider>

			{agent.error ? <Failure message={agent.error.message} /> : null}

			{/*
			 * eve is explicit that only a *waiting* session accepts input. Sending
			 * into one mid-turn used to do nothing at all, with no error — the
			 * message went nowhere and the panel sat there. Saying so is the fix.
			 */}
			{resume?.status === "busy" && !busy ? (
				<p className="border-t px-5 py-2 text-muted-foreground text-xs">
					Still working on the last question. Your next one can go in when it
					finishes.
				</p>
			) : null}

			<form
				className="flex items-center gap-2 border-t px-5 py-3"
				onSubmit={(event) => {
					event.preventDefault();
					ask(draft);
				}}
			>
				<Input
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					placeholder={copy.placeholder}
					disabled={locked}
				/>
				<Button
					type="submit"
					size="icon-sm"
					variant="outline"
					disabled={locked}
				>
					{busy ? <Spinner /> : <Icon icon={Send} />}
					<span className="sr-only">Ask</span>
				</Button>
			</form>
		</div>
	);
}

/**
 * The empty state, which is most reps' first impression of the agent.
 *
 * It says what the panel is *for* and gives something to press, because "ask me
 * anything" in front of somebody who has never used it produces nothing.
 *
 * Every word of it comes from `recordCopy`. A literal here is how this shipped
 * asking "Who is this person?" on a deal: the suggestions were wired to the
 * record and the heading above them was still hardcoded, so the two disagreed
 * on screen.
 */
function Idle({
	kind,
	onAsk,
}: {
	kind: AgentRecord["kind"];
	onAsk: (question: string) => void;
}) {
	const copy = recordCopy(kind);

	// The shared empty state, so the Agent tab reads like the Deals and Contacts
	// tabs beside it rather than like a second product. Only the mark differs —
	// this one is ours, not a Carbon glyph.
	return (
		<Empty>
			<EmptyHeader>
				<EmptyMedia>
					<span className="flex size-8 items-center justify-center bg-foreground text-background">
						<Logo className="size-4" />
					</span>
				</EmptyMedia>
				<EmptyTitle>{copy.title}</EmptyTitle>
				<EmptyDescription>{copy.blurb}</EmptyDescription>
			</EmptyHeader>

			<EmptyContent className="flex-row flex-wrap justify-center">
				{copy.suggestions.map((suggestion) => (
					<Button
						key={suggestion}
						variant="outline"
						size="sm"
						onClick={() => onAsk(suggestion)}
					>
						{suggestion}
					</Button>
				))}
			</EmptyContent>
		</Empty>
	);
}

/**
 * Why the panel is not working, in terms of what to do about it.
 *
 * The two failures a self-hoster actually hits are "the agent is not running"
 * and "the two halves hold different secrets", and the bare text of an HTTP
 * error names neither.
 */
function Failure({ message }: { message: string }) {
	const hint = message.includes("not reachable")
		? "Start it with `bun run dev`, or check AGENT_URL."
		: message.includes("not configured")
			? "Set AGENT_BRIDGE_SECRET for both the app and the agent."
			: null;

	return (
		<div className="border-t px-5 py-3 text-xs">
			<p className="text-destructive">{message}</p>
			{hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
		</div>
	);
}

const TONE_ICONS: Record<Tone, CarbonIcon> = {
	neutral: CircleDash,
	success: Checkmark,
	warning: Warning,
};

const SOURCE_ICONS: Record<Source["network"], CarbonIcon> = {
	linkedin: LogoLinkedin,
	github: LogoGithub,
	web: Document,
};

function Item({ item }: { item: TranscriptItem }) {
	if (item.kind === "said") {
		return item.mine ? (
			<Message align="end">
				<MessageContent>
					<Bubble variant="secondary" align="end">
						<BubbleContent>{item.text}</BubbleContent>
					</Bubble>
				</MessageContent>
			</Message>
		) : (
			<Message>
				<AgentAvatar />
				<MessageContent>
					{/*
					 * `ghost`, so an answer runs full width with no surface behind it.
					 * That is the AI Elements convention — "user messages in secondary
					 * background and assistant messages full-width" — and it earns its
					 * place here: these replies carry lists, links and the occasional
					 * table, and a bubble at 80% width sets all of them in a column
					 * half the panel wide.
					 *
					 * Markdown because the agent writes it. As plain text the same
					 * answer reads as asterisks and pipes.
					 */}
					<Bubble variant="ghost">
						<BubbleContent>
							<Markdown>{item.text}</Markdown>
						</BubbleContent>
					</Bubble>
				</MessageContent>
			</Message>
		);
	}

	return (
		<div className="space-y-1.5">
			<Marker>
				<MarkerIcon>
					{item.pending ? <Spinner /> : <Icon icon={TONE_ICONS[item.tone]} />}
				</MarkerIcon>
				<MarkerContent>{item.label}</MarkerContent>
			</Marker>

			{item.sources.length > 0 ? <Sources sources={item.sources} /> : null}
		</div>
	);
}

/**
 * The pages behind a step.
 *
 * A stretch of `Attachment`'s remit — it is built for files — but a source is
 * the same shape: an icon, a name, and somewhere to go. The alternative was
 * inventing a chip, and `design.md` would rather we reached for what is already
 * in the package.
 */
function Sources({ sources }: { sources: Source[] }) {
	return (
		<AttachmentGroup>
			{sources.map((source) => (
				<Attachment key={source.url} size="xs" state="done">
					<AttachmentMedia variant="icon">
						<Icon icon={SOURCE_ICONS[source.network]} />
					</AttachmentMedia>
					<AttachmentContent>
						<AttachmentTitle>{source.title}</AttachmentTitle>
					</AttachmentContent>

					{/*
					 * A stretched overlay rather than an anchor wrapped around the
					 * card: it keeps the component's own layout intact, makes the whole
					 * tile the hit area, and is what the root's `has-[>a]:hover` styling
					 * is written against.
					 */}
					<AttachmentTrigger asChild>
						<a href={source.url} target="_blank" rel="noreferrer noopener">
							<span className="sr-only">Open {source.title}</span>
						</a>
					</AttachmentTrigger>
				</Attachment>
			))}
		</AttachmentGroup>
	);
}

/**
 * The agent wears the product's own mark.
 *
 * A generic robot glyph says "a chatbot was added here". The Comp AI logo says
 * this is the CRM speaking about its own record — which is what it is, and the
 * distinction is most of the difference in how much a rep trusts the answer.
 */
function AgentAvatar() {
	return (
		<MessageAvatar>
			<span className="flex size-7 items-center justify-center bg-foreground text-background">
				<Logo className="size-3.5" />
			</span>
		</MessageAvatar>
	);
}

/**
 * The agent's own question, answered in place.
 *
 * The case the whole panel earns its keep on: several people with the same
 * surname work at the same company, and the person looking at the record knows
 * which one. `tinted` rather than a plain bubble because this one is *waiting*
 * on them — it should not read as more transcript.
 */
function Question({
	question,
	agent,
}: {
	question: NonNullable<ReturnType<typeof pendingQuestion>>;
	agent: ReturnType<typeof useEveAgent>;
}) {
	return (
		<Message>
			<AgentAvatar />
			<MessageContent>
				<Bubble variant="tinted">
					<BubbleContent>{question.prompt}</BubbleContent>
				</Bubble>

				{/*
				 * `options` is optional: a freeform question has none, and the
				 * composer under the transcript is how that one gets answered.
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
										{ requestId: question.requestId, optionId: option.id },
									],
								})
							}
						>
							{option.label}
						</Button>
					))}
				</div>
			</MessageContent>
		</Message>
	);
}

/**
 * Writes the conversation's cursor back, so it can be reopened.
 *
 * `useEveAgent` hands out a serialisable `session` — id, continuation token,
 * how far the client has read — and that trio is the whole of what resuming a
 * thread needs. Saving it on change is what turns a scratchpad into history.
 *
 * Only when the cursor actually moves. The hook re-renders on every streamed
 * token, and a mutation per token would be a write storm for a value that
 * changes once a turn.
 */
function useSavedConversation({
	record,
	conversation,
	opening,
	session,
	messages,
}: {
	record: { contactId?: string; companyId?: string };
	conversation: Conversation | null;
	opening: React.RefObject<string | null>;
	/** `useEveAgent`'s own cursor. */
	session: {
		sessionId?: string;
		continuationToken?: string;
		streamIndex: number;
	} | null;
	messages: number;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const save = useMutation(trpc.conversations.save.mutationOptions({}));

	const sessionId = session?.sessionId ?? null;
	const token = session?.continuationToken ?? null;
	const streamIndex = session?.streamIndex ?? 0;
	const { contactId, companyId } = record;
	const isNew = conversation === null;

	// Everything the effect needs but must not re-run for. `save` and `record`
	// are new objects on every render, and this hook renders on every streamed
	// token — in the dependency array they would run the effect thousands of
	// times a conversation to do nothing.
	const latest = useRef({ save, queryClient, trpc, opening });
	latest.current = { save, queryClient, trpc, opening };

	// The last cursor written, so an unchanged one is not written again.
	const written = useRef<string | null>(null);

	useEffect(() => {
		if (!sessionId) return;

		const cursor = `${sessionId}:${token ?? ""}:${messages}`;
		if (written.current === cursor) return;
		written.current = cursor;

		const {
			save: mutation,
			queryClient: cache,
			trpc: api,
			opening: title,
		} = latest.current;

		mutation.mutate(
			{
				...(contactId ? { contactId } : {}),
				...(companyId ? { companyId } : {}),
				sessionId,
				continuationToken: token,
				streamIndex,
				messageCount: messages,
				...(isNew ? { title: title.current ?? undefined } : {}),
			},
			{
				// A thread that has just come into existence has to appear in the
				// picker without a reload — that was the "history only shows up if I
				// refresh" half of this. An existing one has only moved its
				// timestamp, and refetching for that mid-answer is churn.
				onSuccess: () => {
					if (!isNew) return;
					void cache.invalidateQueries({
						queryKey: api.conversations.list.pathKey(),
					});
				},
			},
		);
	}, [sessionId, token, streamIndex, messages, contactId, companyId, isNew]);
}
