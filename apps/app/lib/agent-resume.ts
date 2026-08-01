/**
 * Picking a conversation back up.
 *
 * A stored continuation token goes stale the moment a turn finishes without
 * this panel watching — which is the normal case, because switching tabs
 * unmounts it. eve is explicit about the consequence: *only waiting sessions
 * can accept the next user input*, and a stale token is rejected. Sending into
 * one does nothing at all, which is exactly what it looked like.
 *
 * So the token is recovered from the session's own tail rather than trusted
 * from the database, following eve's documented recipe for "if you only
 * persisted `sessionId`": read the newest durable event and take the token off
 * `session.waiting`.
 */

export type ResumeState =
	| {
			/** The tail has not come back yet. Briefly, on opening an old thread. */
			status: "checking";
	  }
	| {
			/** Parked and ready for the next message. */
			status: "waiting";
			continuationToken: string | undefined;
	  }
	| {
			/** Mid-turn. It cannot accept input yet, and saying so beats silence. */
			status: "busy";
	  }
	| {
			/** Over. The next message starts a fresh session, per eve's contract. */
			status: "finished";
	  };

/**
 * The resume state, read off the tail of a session's event stream.
 *
 * The endpoint answers newline-delimited JSON, and a tail read can return more
 * than one line, so the *last* parseable event is the one that counts.
 */
/**
 * How quiet a turn has to go before it counts as dead rather than working.
 *
 * A running turn emits constantly — reasoning deltas, steps, tool results — so
 * a gap this long means the run ended without a boundary: the process was
 * restarted, or the deploy rolled. Those sessions never reach
 * `session.waiting`, and without this they would read as "busy" forever and
 * lock the composer on a conversation that can never answer again.
 */
const ABANDONED_AFTER_MS = 90_000;

export function parseResumeTail(
	ndjson: string,
	now: number = Date.now(),
): ResumeState {
	const last = lastEvent(ndjson);

	if (!last) return { status: "busy" };

	if (last.type === "session.waiting") {
		const token = (last.data as { continuationToken?: unknown } | undefined)
			?.continuationToken;

		return {
			status: "waiting",
			continuationToken: typeof token === "string" ? token : undefined,
		};
	}

	if (last.type === "session.completed" || last.type === "session.failed") {
		return { status: "finished" };
	}

	// Anything else — a step, a tool result, a token of reasoning — means a turn
	// is in flight, *if* it is still moving. One that stopped mid-sentence is
	// over, whatever it was doing, and the next message starts a new session.
	return now - last.at > ABANDONED_AFTER_MS
		? { status: "finished" }
		: { status: "busy" };
}

function lastEvent(
	ndjson: string,
): { type: string; data?: unknown; at: number } | null {
	let found: { type: string; data?: unknown; at: number } | null = null;

	for (const line of ndjson.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		try {
			const event = JSON.parse(trimmed) as {
				type?: unknown;
				data?: unknown;
				meta?: { at?: unknown };
			};
			if (typeof event.type === "string") {
				const at =
					typeof event.meta?.at === "string"
						? Date.parse(event.meta.at)
						: Number.NaN;

				found = {
					type: event.type,
					data: event.data,
					// An event with no readable timestamp is treated as current, so a
					// missing field never retires a live session.
					at: Number.isNaN(at) ? Date.now() : at,
				};
			}
		} catch {
			// A tail read can slice a line in half. Skip it rather than give up on
			// the ones that did arrive whole.
		}
	}

	return found;
}

/**
 * How long to wait for the tail before assuming the session is busy.
 *
 * This read is against a *stream* endpoint. On a session that is mid-turn it
 * does not return — it keeps delivering events as they happen — so without a
 * deadline the panel waits forever on a question whose answer is already
 * "busy". Reading for a moment and taking what arrived is both faster and the
 * same answer.
 */
const TAIL_TIMEOUT_MS = 4000;

/**
 * Asks the agent where a session got to.
 *
 * Goes through the app's own `/eve/v1` proxy, so it carries the session cookie
 * and needs no agent credentials of its own.
 *
 * Never throws and never resolves to "ready" on doubt: a wrong `waiting` sends
 * somebody's message into a void, while a wrong `busy` only asks them to try
 * again in a moment.
 */
export async function readResumeState(
	sessionId: string,
	headers: Record<string, string>,
	signal?: AbortSignal,
): Promise<ResumeState> {
	const deadline = AbortSignal.timeout(TAIL_TIMEOUT_MS);
	const abort = signal ? AbortSignal.any([signal, deadline]) : deadline;

	try {
		const response = await fetch(
			`/eve/v1/session/${encodeURIComponent(sessionId)}/stream?startIndex=-1&includeTailIndex=1`,
			{ headers, signal: abort },
		);

		if (!response.ok || !response.body) return { status: "busy" };

		return parseResumeTail(await firstLine(response.body));
	} catch {
		// Timed out, aborted, or the agent is down. All of them mean "do not
		// promise this session will accept a message".
		return { status: "busy" };
	}
}

/**
 * The first line of the stream, and then stop reading.
 *
 * This endpoint **follows**: it keeps the connection open and delivers events
 * as they happen, and `includeTailIndex` is a header for the *client* to stop
 * on, not an instruction to the server to close. Awaiting the whole body
 * therefore waits forever — which read as "every session is busy", because the
 * deadline fired every time and the composer was never unlocked.
 *
 * `startIndex=-1` asks for the newest event, so the first complete line is the
 * whole answer. Take it and hang up.
 */
async function firstLine(body: ReadableStream<Uint8Array>): Promise<string> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });

			const newline = buffer.indexOf("\n");
			if (newline !== -1) return buffer.slice(0, newline);
		}
	} finally {
		// Nothing else is coming out of this stream, and leaving it open holds a
		// request against the agent for the life of the page.
		await reader.cancel().catch(() => {});
	}

	return buffer;
}
