import { describe, expect, it } from "bun:test";
import {
	field,
	parseAmountCents,
	parseCsv,
	parseCsvDate,
} from "../src/import/csv";

describe("parseCsv", () => {
	it("reads a plain file and reports the spreadsheet line", () => {
		expect(
			parseCsv("name,domain\nStripe,stripe.com\nLinear,linear.app"),
		).toEqual([
			{ line: 2, values: { name: "Stripe", domain: "stripe.com" } },
			{ line: 3, values: { name: "Linear", domain: "linear.app" } },
		]);
	});

	it("keeps line numbers honest when blank rows are skipped", () => {
		// A report that says "fix row 5" has to mean row 5 in the file, not the
		// fifth row that happened to have data in it.
		const rows = parseCsv("name\nStripe\n\n\nLinear\n");

		expect(rows.map((row) => [row.line, row.values.name])).toEqual([
			[2, "Stripe"],
			[5, "Linear"],
		]);
	});

	it("normalises header spelling so any HubSpot export lands", () => {
		const [parsed] = parseCsv("First Name,Company Domain Name\nAda,stripe.com");

		expect(parsed?.values.firstname).toBe("Ada");
		expect(parsed?.values.companydomainname).toBe("stripe.com");
	});

	it("handles quoted fields, commas and escaped quotes", () => {
		const [parsed] = parseCsv(
			'name,note\n"Acme, Inc.","They said ""maybe"" twice"',
		);

		expect(parsed?.values.name).toBe("Acme, Inc.");
		expect(parsed?.values.note).toBe('They said "maybe" twice');
	});

	it("keeps newlines inside a quoted field", () => {
		const [parsed] = parseCsv('name,note\nAcme,"line one\nline two"');

		expect(parsed?.values.note).toBe("line one\nline two");
	});

	it("copes with CRLF, a trailing newline and blank lines", () => {
		expect(
			parseCsv("name\r\nStripe\r\n\r\nLinear\r\n").map((row) => row.values),
		).toEqual([{ name: "Stripe" }, { name: "Linear" }]);
	});

	it("returns nothing for an empty or header-only file", () => {
		expect(parseCsv("")).toEqual([]);
		expect(parseCsv("name,domain")).toEqual([]);
	});

	it("does not let a short row shift the columns", () => {
		const [parsed] = parseCsv("name,domain,phone\nStripe,stripe.com");

		expect(parsed?.values.name).toBe("Stripe");
		expect(parsed?.values.domain).toBe("stripe.com");
		expect(parsed?.values.phone).toBe("");
	});
});

describe("field", () => {
	it("takes the first alias that has a value", () => {
		const [parsed] = parseCsv("First Name,name\n,Stripe");
		if (!parsed) throw new Error("expected a row");

		expect(field(parsed.values, "firstname", "name")).toBe("Stripe");
		expect(field(parsed.values, "nothing", "here")).toBeUndefined();
	});
});

describe("parseAmountCents", () => {
	it("reads what HubSpot writes", () => {
		expect(parseAmountCents("1,234.50")).toBe(123450);
		expect(parseAmountCents("$1,234.50")).toBe(123450);
		expect(parseAmountCents("24000")).toBe(2400000);
		// Floats are rounded to cents rather than carried as fractions.
		expect(parseAmountCents("0.1")).toBe(10);
	});

	it("treats an empty or junk cell as no amount", () => {
		for (const value of ["", "  ", "n/a", "-", undefined]) {
			expect(parseAmountCents(value)).toBeNull();
		}
	});
});

describe("parseCsvDate", () => {
	it("parses a date, and drops one it cannot", () => {
		expect(parseCsvDate("2026-12-31")?.toISOString()).toBe(
			"2026-12-31T00:00:00.000Z",
		);
		expect(parseCsvDate("not a date")).toBeNull();
		expect(parseCsvDate("")).toBeNull();
		expect(parseCsvDate(undefined)).toBeNull();
	});
});
