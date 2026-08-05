export interface CurrencyMeta {
	code: string;
	name: string;
	minorUnits: number;
}

export const DEFAULT_REPORTING_CURRENCY = "USD";

const CURRENCY_LIST: readonly CurrencyMeta[] = [
	{ code: "AED", name: "UAE Dirham", minorUnits: 2 },
	{ code: "ARS", name: "Argentine Peso", minorUnits: 2 },
	{ code: "AUD", name: "Australian Dollar", minorUnits: 2 },
	{ code: "BGN", name: "Bulgarian Lev", minorUnits: 2 },
	{ code: "BHD", name: "Bahraini Dinar", minorUnits: 3 },
	{ code: "BRL", name: "Brazilian Real", minorUnits: 2 },
	{ code: "CAD", name: "Canadian Dollar", minorUnits: 2 },
	{ code: "CHF", name: "Swiss Franc", minorUnits: 2 },
	{ code: "CLP", name: "Chilean Peso", minorUnits: 0 },
	{ code: "CNY", name: "Chinese Yuan", minorUnits: 2 },
	{ code: "COP", name: "Colombian Peso", minorUnits: 2 },
	{ code: "CZK", name: "Czech Koruna", minorUnits: 2 },
	{ code: "DKK", name: "Danish Krone", minorUnits: 2 },
	{ code: "EGP", name: "Egyptian Pound", minorUnits: 2 },
	{ code: "EUR", name: "Euro", minorUnits: 2 },
	{ code: "GBP", name: "Pound Sterling", minorUnits: 2 },
	{ code: "HKD", name: "Hong Kong Dollar", minorUnits: 2 },
	{ code: "HUF", name: "Hungarian Forint", minorUnits: 2 },
	{ code: "IDR", name: "Indonesian Rupiah", minorUnits: 2 },
	{ code: "ILS", name: "Israeli New Shekel", minorUnits: 2 },
	{ code: "INR", name: "Indian Rupee", minorUnits: 2 },
	{ code: "ISK", name: "Icelandic Króna", minorUnits: 0 },
	{ code: "JOD", name: "Jordanian Dinar", minorUnits: 3 },
	{ code: "JPY", name: "Japanese Yen", minorUnits: 0 },
	{ code: "KES", name: "Kenyan Shilling", minorUnits: 2 },
	{ code: "KRW", name: "South Korean Won", minorUnits: 0 },
	{ code: "KWD", name: "Kuwaiti Dinar", minorUnits: 3 },
	{ code: "MAD", name: "Moroccan Dirham", minorUnits: 2 },
	{ code: "MXN", name: "Mexican Peso", minorUnits: 2 },
	{ code: "MYR", name: "Malaysian Ringgit", minorUnits: 2 },
	{ code: "NGN", name: "Nigerian Naira", minorUnits: 2 },
	{ code: "NOK", name: "Norwegian Krone", minorUnits: 2 },
	{ code: "NZD", name: "New Zealand Dollar", minorUnits: 2 },
	{ code: "OMR", name: "Omani Rial", minorUnits: 3 },
	{ code: "PEN", name: "Peruvian Sol", minorUnits: 2 },
	{ code: "PHP", name: "Philippine Peso", minorUnits: 2 },
	{ code: "PKR", name: "Pakistani Rupee", minorUnits: 2 },
	{ code: "PLN", name: "Polish Złoty", minorUnits: 2 },
	{ code: "QAR", name: "Qatari Riyal", minorUnits: 2 },
	{ code: "RON", name: "Romanian Leu", minorUnits: 2 },
	{ code: "RSD", name: "Serbian Dinar", minorUnits: 2 },
	{ code: "SAR", name: "Saudi Riyal", minorUnits: 2 },
	{ code: "SEK", name: "Swedish Krona", minorUnits: 2 },
	{ code: "SGD", name: "Singapore Dollar", minorUnits: 2 },
	{ code: "THB", name: "Thai Baht", minorUnits: 2 },
	{ code: "TND", name: "Tunisian Dinar", minorUnits: 3 },
	{ code: "TRY", name: "Turkish Lira", minorUnits: 2 },
	{ code: "TWD", name: "New Taiwan Dollar", minorUnits: 2 },
	{ code: "UAH", name: "Ukrainian Hryvnia", minorUnits: 2 },
	{ code: "USD", name: "US Dollar", minorUnits: 2 },
	{ code: "UYU", name: "Uruguayan Peso", minorUnits: 2 },
	{ code: "VND", name: "Vietnamese Dong", minorUnits: 0 },
	{ code: "ZAR", name: "South African Rand", minorUnits: 2 },
] as const;

export const CURRENCIES = CURRENCY_LIST;

const BY_CODE = new Map(CURRENCY_LIST.map((entry) => [entry.code, entry]));

export const CURRENCY_CODES: readonly string[] = CURRENCY_LIST.map(
	(entry) => entry.code,
);

const SHAPE = /^[A-Za-z]{3}$/;

export function normalizeCurrency(value: string | null | undefined): string {
	return (value ?? "").trim().toUpperCase();
}

export function isCurrencyCode(value: string | null | undefined): boolean {
	return BY_CODE.has(normalizeCurrency(value));
}

export function currencyMeta(
	value: string | null | undefined,
): CurrencyMeta | null {
	return BY_CODE.get(normalizeCurrency(value)) ?? null;
}

export function currencyName(value: string | null | undefined): string | null {
	return currencyMeta(value)?.name ?? null;
}

export function minorUnitsOf(value: string | null | undefined): number {
	return currencyMeta(value)?.minorUnits ?? 2;
}

export function isWellFormedCurrency(
	value: string | null | undefined,
): boolean {
	return SHAPE.test((value ?? "").trim());
}
