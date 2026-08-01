import type { MessageStreamEvent, SessionState } from "eve/client";
import { Client } from "eve/client";

/**
 * Picking a conversation back up, the way eve says to.
 *
 * This file replaced a hand-rolled one that read the tail of the event stream
 * over raw `fetch` and inferred a state machine from the last line. Every bug
 * in the panel came out of that: the stream opens with a blank line, so the
 * "last line" was empty and every thread read as busy; the endpoint *follows*,
 * so awaiting the body never returned; a read that failed reported the session
 * as working rather than reporting itself as broken.
 *
 * `session.snapshot()` is the documented answer to the exact question that code
 * was asking, and it answers all of it at once: the complete event prefix, the
 * cursor that continues from it, and a continuation token *if and only if* the
 * session is parked and will accept another turn. One request, ~30ms against a
 * hundred-event thread, no parsing.
 */

/** How long a turn can go silent before it is dead rather than working. */
const ABANDONED_AFTER_MS = 90_000;

export type Thread =
	| {
			/** Nothing has been sent yet. There is no session to load. */
			status: "new";
	  }
	| {
			/** Parked, with a live token. The composer is open. */
			status: "ready";
			session: SessionState;
			events: readonly MessageStreamEvent[];
	  }
	| {
			/**
			 * A turn is in flight — started by another tab, or by this one before
			 * the page reloaded. eve will not take input until it settles.
			 */
			status: "working";
			session: SessionState;
			events: readonly MessageStreamEvent[];
	  }
	| {
			/**
			 * Over: completed, failed, or abandoned mid-sentence by a runtime that
			 * restarted. Nothing can be sent into it again, so the panel offers a
			 * new conversation instead of a disabled box.
			 */
			status: "ended";
			session: SessionState;
			events: readonly MessageStreamEvent[];
	  }
	| {
			/**
			 * The agent could not be reached, or the session has aged out of eve's
			 * 30-day retention.
			 *
			 * Deliberately distinct from `working`: that is a claim about the
			 * session, and this is a fact about us. Reported as the former it was
			 * both untrue and unrecoverable — the read fails identically next time,
			 * so the composer stayed shut forever. Here the transcript comes from
			 * our own archive and a send starts a fresh session.
			 */
			status: "offline";
			events: readonly MessageStreamEvent[];
	  };

/**
 * Loads a thread: its transcript, its cursor, and whether it can be written to.
 *
 * `archive` is our own `AgentEvent` mirror, used only when eve cannot answer —
 * a month-old thread outlives the session it was held in, and a rep reopening
 * one should still be able to read it.
 */
export async function loadThread(
	sessionId: string,
	headers: Record<string, string>,
	archive: readonly MessageStreamEvent[] = [],
	signal?: AbortSignal,
): Promise<Thread> {
	try {
		// `host: ""` is same-origin, which is where the app proxies `/eve/v1/*`
		// from — the browser never learns the agent has an origin of its own.
		const snapshot = await new Client({ headers, host: "" })
			.session({ sessionId, streamIndex: 0 })
			.snapshot({ signal });

		return {
			status: classify(snapshot.session, snapshot.events),
			session: snapshot.session,
			events: snapshot.events,
		} as Thread;
	} catch {
		return { status: "offline", events: archive };
	}
}

/**
 * Which of the three live states a snapshot describes.
 *
 * Exported for its tests: this is the one judgement call in the file, and the
 * cost of getting it wrong is a thread that can never be typed into again.
 */
export function classify(
	session: SessionState,
	events: readonly MessageStreamEvent[],
	now: number = Date.now(),
): "ready" | "working" | "ended" {
	// The token is the authority, not our reading of the events: eve returns one
	// only when the captured prefix ends parked, which is exactly the condition
	// under which the next send will be accepted.
	if (session.continuationToken) return "ready";

	const last = events.at(-1);
	if (!last) return "ended";

	if (last.type === "session.completed" || last.type === "session.failed") {
		return "ended";
	}

	// Mid-turn, and the only question left is whether anything is still running.
	// A live turn emits constantly — deltas, steps, tool results — so a long gap
	// means the run died without a boundary, which a restart or a redeploy does
	// routinely. Those sessions never park, and calling them "working" locks the
	// thread for good.
	const at = Date.parse(last.meta.at);

	return Number.isNaN(at) || now - at < ABANDONED_AFTER_MS
		? "working"
		: "ended";
}

/** The transcript to render, whatever state the thread turned out to be in. */
export function eventsOf(
	thread: Thread | undefined,
): readonly MessageStreamEvent[] {
	return thread && "events" in thread ? thread.events : [];
}

/** Whether the composer takes input, and whether this thread is over. */
export type ComposerState = {
	locked: boolean;
	/** Permanently. The way on is a new conversation, not waiting. */
	ended: boolean;
};

/**
 * What the composer may do.
 *
 * `busy` is this panel's own send. Everything else comes from the thread, and
 * the two states that both disable the box mean very different things: one is a
 * wait of seconds, the other is permanent.
 */
export function composerState(
	thread: Thread | undefined,
	busy: boolean,
): ComposerState {
	const ended = thread?.status === "ended";

	return {
		ended,
		// `offline` is not here on purpose: we could not ask, so let the send
		// try. It either works or raises an error the panel already shows.
		locked: busy || ended || thread?.status === "working",
	};
}
