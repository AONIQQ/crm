import { z } from "zod";

export const IMPORT_KINDS = ["companies", "contacts", "deals"] as const;

export type ImportKind = (typeof IMPORT_KINDS)[number];

export const importInput = z.object({
	kind: z.enum(IMPORT_KINDS),
	/** The file's contents. Imports are a few thousand rows, not a data lake. */
	csv: z.string().min(1, "That file is empty."),
	/**
	 * A dry run reports what *would* happen and writes nothing.
	 *
	 * Defaults to `true`: an import that silently rewrites the CRM on the first
	 * click is how a bad column mapping becomes a restore-from-backup.
	 */
	dryRun: z.boolean().default(true),
	/** Owner for rows that do not name one. */
	defaultOwnerId: z.string().nullable().optional(),
});

export type ImportInput = z.infer<typeof importInput>;

/** What one row would do, or did. */
export type RowOutcome = "created" | "updated" | "skipped" | "failed";

export type ImportRowReport = {
	/** 1-based, counting the header as row 1 — what a spreadsheet shows. */
	line: number;
	outcome: RowOutcome;
	/** The domain, email or deal name the row was matched on. */
	key: string | null;
	label: string | null;
	reason?: string;
};

export type ImportReport = {
	kind: ImportKind;
	dryRun: boolean;
	total: number;
	created: number;
	updated: number;
	skipped: number;
	failed: number;
	/** Every row, so a dry run can be read before committing to it. */
	rows: ImportRowReport[];
};
