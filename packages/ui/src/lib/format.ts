/**
 * Formatting shared by every module surface.
 *
 * `formatCount` existed three times over — identically — in
 * `code-security/cs-ui`, `cloud-security/cloud-ui` and `people/people-ui`.
 *
 * `relativeTimeFromIso` was defined in `code-security/cs-ui` and imported
 * across module boundaries by People. It is deliberately NOT merged with the
 * epoch-milliseconds `relativeTime` in `apps/app/lib/format-date`: they take
 * different inputs and disagree on the empty case ("—" vs "Never"), so folding
 * them together would silently change copy in one module or the other. Both
 * names are kept so the difference is visible at the call site.
 *
 * `formatMoney` moved here from `components/admin/admin-ui`, which is now needed
 * by the People upgrade surfaces too. It is deliberately NOT merged with the
 * billing page's local `formatMoney`: that one always renders two decimals
 * (invoice amounts), this one drops them for whole dollars. Folding them
 * together would silently change billing copy.
 */

export function formatCount(count: number, noun: string): string {
	return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

const WELL_FORMED_CURRENCY_CODE = /^[A-Za-z]{3}$/;

function displayCurrencyCode(currency: string): string {
	return WELL_FORMED_CURRENCY_CODE.test(currency)
		? currency.toUpperCase()
		: "USD";
}

export function formatMoney(cents: number, currency = "usd"): string {
	return new Intl.NumberFormat(undefined, {
		style: "currency",
		currency: displayCurrencyCode(currency),
		minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
	}).format(cents / 100);
}

/**
 * `"$128K"` — a headline where the exact dollar is noise.
 *
 * Deliberately separate from `formatMoney`: a figure a rep reads at a glance
 * wants three characters, and a figure they are about to act on wants all of
 * them. Rounding a row in a table would be a bug; rounding a KPI is the point.
 */
export function formatMoneyCompact(cents: number, currency = "usd"): string {
	return new Intl.NumberFormat(undefined, {
		style: "currency",
		currency: displayCurrencyCode(currency),
		notation: "compact",
		maximumFractionDigits: cents % 100_000 === 0 ? 0 : 1,
	}).format(cents / 100);
}

/** A 0–1 rate as `"62%"`. */
export function formatPercent(rate: number): string {
	return new Intl.NumberFormat(undefined, {
		style: "percent",
		maximumFractionDigits: 0,
	}).format(rate);
}

export function relativeTimeFromIso(iso: string | null | undefined): string {
	if (!iso) return "—";
	const then = new Date(iso).getTime();
	if (!Number.isFinite(then)) return "—";
	const diff = Date.now() - then;
	const abs = Math.abs(diff);
	const min = 60_000;
	const hour = 60 * min;
	const day = 24 * hour;
	if (abs < min) return "just now";
	const distance =
		abs < hour
			? `${Math.round(abs / min)}m`
			: abs < day
				? `${Math.round(abs / hour)}h`
				: abs < 30 * day
					? `${Math.round(abs / day)}d`
					: null;
	if (distance === null) {
		return new Date(iso).toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
		});
	}
	return diff < 0 ? `in ${distance}` : `${distance} ago`;
}

export function initialsFromName(name: string | null | undefined): string {
	const parts = (name ?? "").split(/\s+/).filter(Boolean);
	const first = parts[0];
	if (!first) return "?";
	if (parts.length === 1) return first.slice(0, 2).toUpperCase();
	const last = parts[parts.length - 1] ?? first;
	return (first.slice(0, 1) + last.slice(0, 1)).toUpperCase();
}
