"use client";

import { parseAsArrayOf, parseAsString, useQueryState } from "nuqs";
import { useCallback, useMemo } from "react";

export const RECORD_KINDS = ["company", "contact", "deal"] as const;

export type RecordKind = (typeof RECORD_KINDS)[number];

export type RecordRef = { kind: RecordKind; id: string };

/**
 * Which records are open, innermost last.
 *
 * A stack rather than a single id because the interesting move is sideways:
 * from a company to one of its deals to somebody on that deal. Closing the
 * deal should put you back on the company you came from, not on the table.
 */
const stackParser = parseAsArrayOf(parseAsString, ",").withDefault([]);

export function recordKey(ref: RecordRef): string {
	return `${ref.kind}:${ref.id}`;
}

function parseRef(raw: string): RecordRef | null {
	const [kind, ...rest] = raw.split(":");
	const id = rest.join(":");
	if (!id) return null;
	return RECORD_KINDS.includes(kind as RecordKind)
		? { kind: kind as RecordKind, id }
		: null;
}

export function useRecordStack() {
	const [raw, setRaw] = useQueryState("record", stackParser);

	const stack = useMemo(
		() => raw.map(parseRef).filter((ref): ref is RecordRef => ref !== null),
		[raw],
	);

	const write = useCallback(
		(next: RecordRef[], history: "push" | "replace") => {
			// `null` clears the param rather than leaving `?record=` behind.
			void setRaw(next.length === 0 ? null : next.map(recordKey), { history });
		},
		[setRaw],
	);

	/**
	 * The whole trail is one history entry.
	 *
	 * Opening the first record pushes; stepping sideways to a related one
	 * replaces. So the browser's Back always means "put the sheet away and give
	 * me the list back" — one press, from however deep — and it never lands on
	 * a half-unwound trail or reopens something that was just dismissed. Moving
	 * up one level is what the sheet's own Back button is for.
	 */
	const open = useCallback(
		(ref: RecordRef) => {
			const key = recordKey(ref);
			// Re-opening something already below you promotes it instead of
			// stacking a second copy, so the trail cannot loop back on itself.
			write(
				[...stack.filter((entry) => recordKey(entry) !== key), ref],
				stack.length === 0 ? "push" : "replace",
			);
		},
		[stack, write],
	);

	/** Up one level, to whatever you opened this record from. */
	const close = useCallback(
		() => write(stack.slice(0, -1), "replace"),
		[stack, write],
	);

	/** Out of the trail entirely — the X, Escape, and clicking the backdrop. */
	const closeAll = useCallback(() => write([], "replace"), [write]);

	return {
		stack,
		top: stack.at(-1) ?? null,
		open,
		close,
		closeAll,
	};
}

/** Opens a record from anywhere — a table row, a link, a search hit. */
export function useOpenRecord() {
	return useRecordStack().open;
}
