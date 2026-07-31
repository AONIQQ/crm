/**
 * A CSV reader, rather than a dependency.
 *
 * HubSpot exports are RFC 4180: comma-separated, `"` quoting, `""` for a
 * literal quote, and newlines allowed inside quoted fields. That is the whole
 * grammar, and it is about forty lines — small enough that owning it beats
 * taking a parser we would then have to keep patched.
 */

export type CsvRow = Record<string, string>;

/**
 * A row plus the line it came from.
 *
 * The line number is the point of the import report — "fix row 214" is only
 * useful if 214 is what the spreadsheet shows. Blank rows are dropped from the
 * results but still consume a line number.
 */
export type ParsedRow = { line: number; values: CsvRow };

/** Splits a CSV document into rows of raw cells. */
function parseRows(input: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;

	// Normalising line endings first means the state machine below only has to
	// think about `\n`.
	const text = input.replace(/\r\n?/g, "\n");

	for (let index = 0; index < text.length; index++) {
		const char = text[index];

		if (quoted) {
			if (char === '"') {
				if (text[index + 1] === '"') {
					cell += '"';
					index += 1;
				} else {
					quoted = false;
				}
			} else {
				cell += char;
			}
			continue;
		}

		if (char === '"') {
			quoted = true;
		} else if (char === ",") {
			row.push(cell);
			cell = "";
		} else if (char === "\n") {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = "";
		} else {
			cell += char;
		}
	}

	// A file that does not end in a newline still has a last row.
	if (cell !== "" || row.length > 0) {
		row.push(cell);
		rows.push(row);
	}

	return rows;
}

/**
 * Parses a CSV into objects keyed by header.
 *
 * Headers are lower-cased and stripped of punctuation so "First Name",
 * "first_name" and "FIRST NAME" all land on `firstname` — HubSpot's column
 * names differ between export types and versions, and a rep should not have to
 * care which one they got.
 */
export function parseCsv(input: string): ParsedRow[] {
	const all = parseRows(input);

	// The header is the first row with anything in it; anything above it is
	// blank padding, and it still counts towards the line numbers below.
	const headerIndex = all.findIndex((row) =>
		row.some((cell) => cell.trim() !== ""),
	);
	if (headerIndex === -1) return [];

	const keys = (all[headerIndex] ?? []).map(normalizeHeader);
	const parsed: ParsedRow[] = [];

	for (let index = headerIndex + 1; index < all.length; index++) {
		const row = all[index] ?? [];
		if (!row.some((cell) => cell.trim() !== "")) continue;

		const values: CsvRow = {};
		for (const [column, key] of keys.entries()) {
			if (!key) continue;
			const value = row[column]?.trim() ?? "";
			// A repeated header should not blank out the column that has data.
			if (value !== "" || !(key in values)) values[key] = value;
		}

		// 1-based, counting the header — what a spreadsheet shows in the gutter.
		parsed.push({ line: index + 1, values });
	}

	return parsed;
}

export function normalizeHeader(header: string): string {
	return header
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "");
}

/** First non-empty value among the aliases a column might be called. */
export function field(row: CsvRow, ...aliases: string[]): string | undefined {
	for (const alias of aliases) {
		const value = row[normalizeHeader(alias)];
		if (value) return value;
	}
	return undefined;
}

/**
 * HubSpot writes amounts as `1,234.50` or `$1,234.50`. Returns integer cents,
 * or `null` when the cell is empty or not a number.
 */
export function parseAmountCents(value: string | undefined): number | null {
	if (!value) return null;
	const cleaned = value.replace(/[^0-9.-]/g, "");
	if (cleaned === "" || cleaned === "-") return null;
	const parsed = Number.parseFloat(cleaned);
	return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

/** A date cell, or `null` — an unparseable date is dropped, not guessed at. */
export function parseCsvDate(value: string | undefined): Date | null {
	if (!value) return null;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}
