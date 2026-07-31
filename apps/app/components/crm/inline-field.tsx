"use client";

import { Button } from "@crm/ui/components/button";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import { Input } from "@crm/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import { Spinner } from "@crm/ui/components/spinner";
import { useId, useState } from "react";

/** Label column, so every property in the sheet lines up on one edge. */
const ROW = "grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2 py-0.5";
const LABEL = "truncate text-muted-foreground text-xs";
/**
 * Values look like text until you point at one.
 *
 * A row of boxed inputs shouts "form" at someone who came here to read a
 * record; a row of plain text gives no hint that a typo is one click from
 * fixed. The hover outline is the whole affordance, and it is the same on a
 * typed field and a chosen one so nothing looks more editable than the rest.
 */
const CONTROL =
	"h-8 w-full justify-start px-2 font-normal hover:border-input hover:bg-muted/40 border border-transparent";

/**
 * Which property a record's shared update mutation is currently writing.
 *
 * One `update` serves every row in a sheet, so its `isPending` says only that
 * *something* is saving. Handing that to each row puts a spinner on all seven
 * of them the moment you correct one — the whole form flashes for a write to a
 * single field. The variables of the write name the field, so the spinner can
 * land on the row that was actually edited and nowhere else.
 */
export function savingField(update: {
	isPending: boolean;
	variables?: { data?: object } | undefined;
}): (field: string) => boolean {
	const fields = update.isPending
		? Object.keys(update.variables?.data ?? {})
		: [];
	return (field) => fields.includes(field);
}

export function InlineField({
	label,
	value,
	onSave,
	saving = false,
	placeholder,
	type = "text",
	render,
}: {
	label: string;
	value: string | null;
	onSave: (next: string) => void;
	saving?: boolean;
	placeholder?: string;
	type?: "text" | "url" | "email" | "tel";
	/** How the saved value reads when not being edited — a link, usually. */
	render?: (value: string) => React.ReactNode;
}) {
	const id = useId();
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(value ?? "");

	const commit = () => {
		setEditing(false);
		if (draft.trim() !== (value ?? "")) onSave(draft.trim());
	};

	// Mid-write, the row reads back what was typed rather than what the record
	// still says. The input closes on commit but the new value only arrives with
	// the refetch, so reading `value` here would show the old one for the length
	// of a round trip — which looks like the edit was thrown away.
	const shown = saving ? draft.trim() : (value ?? "");

	return (
		<div className={ROW}>
			<label htmlFor={id} className={LABEL}>
				{label}
			</label>

			{editing ? (
				<Input
					id={id}
					type={type}
					// The input only exists because the user just clicked this field;
					// not focusing it would mean clicking twice to type once.
					autoFocus
					value={draft}
					placeholder={placeholder}
					onChange={(event) => setDraft(event.target.value)}
					onBlur={commit}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							commit();
						}
						if (event.key === "Escape") {
							setDraft(value ?? "");
							setEditing(false);
						}
					}}
				/>
			) : (
				<Button
					variant="ghost"
					size="sm"
					className={CONTROL}
					onClick={() => {
						setDraft(value ?? "");
						setEditing(true);
					}}
				>
					{saving ? <Spinner /> : null}
					{shown ? (
						<span className="truncate">{render ? render(shown) : shown}</span>
					) : (
						<span className="truncate text-muted-foreground">
							{placeholder ?? <EmptyCellValue />}
						</span>
					)}
				</Button>
			)}
		</div>
	);
}

/** The same row, for a value chosen from a list rather than typed. */
export function InlineSelectField({
	label,
	value,
	options,
	onSave,
	placeholder = "None",
}: {
	label: string;
	value: string;
	options: { value: string; label: string }[];
	onSave: (next: string) => void;
	placeholder?: string;
}) {
	const id = useId();

	return (
		<div className={ROW}>
			<label htmlFor={id} className={LABEL}>
				{label}
			</label>
			<Select value={value} onValueChange={onSave}>
				{/* `default` size, matching the text rows' 32px — a select that is a
				    pixel shorter than the field above it makes the column look bent. */}
				<SelectTrigger id={id} variant="ghost" className="w-full">
					<SelectValue placeholder={placeholder} />
				</SelectTrigger>
				<SelectContent>
					{options.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
