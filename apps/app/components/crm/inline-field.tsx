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

/**
 * A property that turns into an input when you click it.
 *
 * The detail page is where reps live, and a card of read-only values with an
 * "Edit" mode over the whole thing means five clicks to fix one typo. Each
 * field saves on Enter or blur and reverts on Escape.
 */
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

	return (
		<div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-3 py-1.5">
			<label htmlFor={id} className="truncate text-muted-foreground text-xs">
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
					className="h-8 justify-start font-normal"
					onClick={() => {
						setDraft(value ?? "");
						setEditing(true);
					}}
				>
					{saving ? <Spinner /> : null}
					{value ? (
						<span className="truncate">{render ? render(value) : value}</span>
					) : (
						<span className="text-muted-foreground">
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
		<div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-3 py-1.5">
			<label htmlFor={id} className="truncate text-muted-foreground text-xs">
				{label}
			</label>
			<Select value={value} onValueChange={onSave}>
				<SelectTrigger id={id} size="sm">
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
