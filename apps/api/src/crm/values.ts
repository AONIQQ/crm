import type { Prisma } from "@crm/db";

/**
 * Money crosses the wire as integer cents.
 *
 * Prisma's `Decimal` has no JSON representation, and a float would make summing
 * a pipeline lossy. Cents are exact integers well inside
 * `Number.MAX_SAFE_INTEGER` for anything `Decimal(14, 2)` can hold, and
 * `formatMoney` in `@crm/ui` already takes them.
 */
export function toCents(amount: Prisma.Decimal | null): number | null {
	return amount === null ? null : amount.times(100).toNumber();
}

/** Cents back to the column's scale, for a write. */
export function fromCents(cents: number | null | undefined): number | null {
	return cents === null || cents === undefined ? null : cents / 100;
}

/**
 * `""` means "clear this", `"  x "` means `"x"`.
 *
 * Inline editors send whatever is in the box, and storing an empty string would
 * make "no phone number" and "a phone number that is blank" two different
 * states that render identically.
 */
export function blankToNull(value: string): string | null {
	const trimmed = value.trim();
	return trimmed === "" ? null : trimmed;
}
