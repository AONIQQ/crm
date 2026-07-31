"use client";

import {
	parseAsArrayOf,
	parseAsString,
	parseAsStringLiteral,
	useQueryStates,
} from "nuqs";
import { useCallback, useMemo } from "react";

const RECORD_KINDS = ["company", "contact", "deal"] as const;

export type RecordKind = (typeof RECORD_KINDS)[number];

export type RecordRef = { kind: RecordKind; id: string };

/** The quick-add forms a record sheet can have open inside it. */
const RECORD_FORMS = ["contact", "deal"] as const;

export type RecordForm = (typeof RECORD_FORMS)[number];

/** The panel a quick-add form belongs to. */
const FORM_TAB: Record<RecordForm, string> = {
	contact: "contacts",
	deal: "deals",
};

/**
 * Everything about what the sheet is showing: which records are open
 * (innermost last), which tab of the innermost one, and which quick-add form
 * inside that.
 *
 * A stack rather than a single id because the interesting move is sideways:
 * from a company to one of its deals to somebody on that deal. Closing the
 * deal should put you back on the company you came from, not on the table.
 *
 * All three ride in one hook so a write to any of them can clear the others.
 * Moving to another record has to reset the tab and drop a half-typed form —
 * otherwise they reappear, out of context, on whatever you opened next.
 *
 * `tab` and `add` replace rather than push: flicking through tabs is reading,
 * not navigating, and a Back button that walks you through four panels before
 * it closes the sheet is a Back button nobody presses twice.
 */
const params = {
	record: parseAsArrayOf(parseAsString, ",").withDefault([]),
	tab: parseAsString,
	add: parseAsStringLiteral(RECORD_FORMS),
};

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
	const [{ record }, setParams] = useQueryStates(params);

	const stack = useMemo(
		() => record.map(parseRef).filter((ref): ref is RecordRef => ref !== null),
		[record],
	);

	const write = useCallback(
		(next: RecordRef[], history: "push" | "replace") => {
			void setParams(
				// `null` clears each param rather than leaving `?record=` behind.
				{
					record: next.length === 0 ? null : next.map(recordKey),
					tab: null,
					add: null,
				},
				{ history },
			);
		},
		[setParams],
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

/**
 * What the open record sheet is showing — the tab, and the quick-add form
 * inside it.
 *
 * In the URL rather than component state, like every other view state here:
 * "the Attio deal, on Activity" is then a link you can send someone, and a
 * half-finished "add a contact" survives a refresh instead of being silently
 * discarded.
 */
export function useRecordSheetView(fallbackTab: string) {
	const [{ tab, add }, setParams] = useQueryStates(params);

	// A form open in a panel implies the panel: landing on `?add=contact`
	// should show the contacts tab, not leave the form mounted out of sight
	// behind whichever tab happened to be the default.
	const active = add ? FORM_TAB[add] : (tab ?? fallbackTab);

	const setTab = useCallback(
		(next: string) => {
			// Leaving the panel abandons the form that lived in it, and the
			// default tab is the absence of the param rather than a value.
			void setParams({ tab: next === fallbackTab ? null : next, add: null });
		},
		[setParams, fallbackTab],
	);

	const setForm = useCallback(
		(next: RecordForm | null) => void setParams({ add: next }),
		[setParams],
	);

	return { tab: active, setTab, form: add, setForm };
}
