"use client";

import { useState } from "react";
import { CloseReasonDialog } from "@/components/crm/stage-change";
import { CompanySheet } from "./company-sheet";
import { ContactSheet } from "./contact-sheet";
import { DealSheet } from "./deal-sheet";
import { type RecordRef, recordKey, useRecordStack } from "./record-stack";

/**
 * The one place a company, contact or deal is rendered.
 *
 * Mounted in the app shell rather than per page, so opening a contact from a
 * deal on the deals board works the same as opening one from the contacts
 * table — and so no list has to carry a copy of every sheet a row might lead
 * to.
 */
export function RecordSheetHost() {
	const { top, closeAll } = useRecordStack();

	// The record that was last open, kept a beat longer than the URL says.
	// Unmounting the instant `?record=` clears would cut the close animation
	// off halfway and make the sheet vanish rather than slide out.
	const [shown, setShown] = useState<RecordRef | null>(top);
	if (top && (!shown || recordKey(shown) !== recordKey(top))) {
		setShown(top);
	}

	const open = top !== null;
	// Escape, the X and the backdrop all mean "I am done here", so they leave
	// the trail rather than stepping up one record at a time — going up is what
	// the Back button in the header is for.
	const onOpenChange = (next: boolean) => {
		if (!next) closeAll();
	};

	return (
		<>
			{shown?.kind === "company" ? (
				<CompanySheet
					// A new company reuses the sheet, so remount to reset the tab and
					// drop the last record's scroll position.
					key={shown.id}
					companyId={shown.id}
					open={open}
					onOpenChange={onOpenChange}
				/>
			) : null}

			{shown?.kind === "contact" ? (
				<ContactSheet
					key={shown.id}
					contactId={shown.id}
					open={open}
					onOpenChange={onOpenChange}
				/>
			) : null}

			{shown?.kind === "deal" ? (
				<DealSheet
					key={shown.id}
					dealId={shown.id}
					open={open}
					onOpenChange={onOpenChange}
				/>
			) : null}

			{/*
			 * "Why did we lose it?" is asked from a table row, a board card and a
			 * deal sheet. One dialog for all of them, reading which deal from the
			 * URL, beats one per row.
			 */}
			<CloseReasonDialog />
		</>
	);
}
