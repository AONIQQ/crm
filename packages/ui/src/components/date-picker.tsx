"use client";

import CalendarGlyph from "@carbon/icons-react/es/Calendar";
import { Button } from "@crm/ui/components/button";
import { Calendar } from "@crm/ui/components/calendar";
import { Icon } from "@crm/ui/components/icon";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@crm/ui/components/popover";
// The same trigger as a select, deliberately. A date and a stage sit in the
// same column of the same record sheet, and two copies of these classes is how
// one of them ends up a pixel taller than the other.
import { selectTriggerVariants } from "@crm/ui/components/select";
import { formatDay, fromDay, toDay } from "@crm/ui/lib/format";
import { cn } from "@crm/ui/lib/utils";
import type { VariantProps } from "class-variance-authority";
import { useState } from "react";

/**
 * Picking a day, from a calendar rather than from the browser's own widget.
 *
 * `<input type="date">` is drawn by the platform: it ignores every token in
 * this repo, changes shape between Chrome and Safari, and on a record sheet
 * full of borderless rows it is the one control with a chrome outline and a
 * greyed `mm/dd/yyyy` in it. This is the shared calendar in a popover behind a
 * trigger that matches the select next to it.
 *
 * It speaks day strings, not `Date`s, because that is what the deal API stores
 * and what the callers hold in state — handing each of them a `Date` would
 * mean three copies of the conversion in `lib/format`, which is where the
 * timezone bug came from the first time.
 */
export function DatePicker({
	id,
	value,
	onChange,
	placeholder = "Select a date",
	variant,
}: {
	id?: string;
	/** `2026-12-31` — or a full ISO timestamp, of which only the day is read. */
	value: string | null | undefined;
	/** The chosen day, or `""` when it was cleared. */
	onChange: (next: string) => void;
	placeholder?: string;
} & VariantProps<typeof selectTriggerVariants>) {
	const [open, setOpen] = useState(false);
	const selected = fromDay(value);
	const thisYear = new Date().getFullYear();

	const choose = (next: string) => {
		setOpen(false);
		if (next !== (value ?? "")) onChange(next);
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					id={id}
					data-slot="date-picker-trigger"
					data-size="default"
					// What Radix stamps on a select with nothing chosen, and what the
					// shared trigger greys the label on.
					data-placeholder={selected ? undefined : ""}
					// Full width, like the select and the input it shares a column
					// with. Nothing here wants a date control sized to its own label.
					className={cn(selectTriggerVariants({ variant }), "w-full")}
				>
					<span className="line-clamp-1">
						{selected ? formatDay(value) : placeholder}
					</span>
					<Icon
						icon={CalendarGlyph}
						className="size-4 text-muted-foreground transition-opacity"
					/>
				</button>
			</PopoverTrigger>
			<PopoverContent size="fit" align="start">
				<Calendar
					mode="single"
					selected={selected}
					// A dropdown caption with no range given is clamped to the end of
					// *this* year by react-day-picker, so "December 2027" — an entirely
					// ordinary close date — was not in the year list at all, and the
					// next-month arrow stopped dead in December.
					startMonth={new Date(thisYear - 10, 0)}
					endMonth={new Date(thisYear + 10, 11)}
					// Opening on a record's own close date rather than on this month:
					// the reason to open this is usually to move a date, not to set
					// one from scratch.
					defaultMonth={selected}
					onSelect={(next) => choose(next ? toDay(next) : "")}
					captionLayout="dropdown"
					autoFocus
				/>
				{/* Every date here is optional, and a calendar with no way back to
				    "none" makes a mis-click permanent. Only once there is something
				    to clear. */}
				{selected ? (
					<div className="border-t p-1">
						<Button
							variant="ghost"
							size="sm"
							className="w-full justify-start"
							onClick={() => choose("")}
						>
							Clear
						</Button>
					</div>
				) : null}
			</PopoverContent>
		</Popover>
	);
}
