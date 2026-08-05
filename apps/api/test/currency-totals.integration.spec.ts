import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db, RateSource } from "@crm/db";
import { SETTINGS_ID, writeReportingCurrency } from "@crm/db/settings";
import { ActivityStampService } from "../src/crm/activity-stamp.service";
import { ConversionService } from "../src/currency/conversion.service";
import { DashboardService } from "../src/dashboard/dashboard.service";
import { DealsService } from "../src/deals/deals.service";

const suffix = process.env.TEST_RUN_ID ?? "currency-totals-spec";
const userId = `user-${suffix}`;
const domain = `money-${suffix}.test`;

const conversion = new ConversionService(db);
const deals = new DealsService(db, new ActivityStampService(db), conversion);
const dashboard = new DashboardService(db, conversion);

let companyId: string;
let previousReportingCurrency: string | null = null;

const MILLION = 100_000_000;
const HALF_MILLION = 50_000_000;

async function rate(quote: string, value: string, source: RateSource) {
	await db.exchangeRate.upsert({
		where: {
			baseCurrency_quoteCurrency_source: {
				baseCurrency: "USD",
				quoteCurrency: quote,
				source,
			},
		},
		create: {
			baseCurrency: "USD",
			quoteCurrency: quote,
			rate: value,
			asOf: new Date("2026-08-01T00:00:00.000Z"),
			source,
		},
		update: { rate: value },
	});
}

async function clearRates() {
	await db.exchangeRate.deleteMany({
		where: {
			baseCurrency: { in: ["USD", "EUR"] },
			quoteCurrency: { in: ["USD", "EUR", "CHF"] },
		},
	});
}

async function pipelineCents(): Promise<number> {
	const summary = await dashboard.summary(userId, { scope: "me" });
	return summary.pipeline.totalCents;
}

beforeAll(async () => {
	const existing = await db.appSetting.findUnique({
		where: { id: SETTINGS_ID },
		select: { reportingCurrency: true },
	});
	previousReportingCurrency = existing?.reportingCurrency ?? null;

	await writeReportingCurrency(db, "USD");
	await clearRates();

	await db.user.upsert({
		where: { id: userId },
		create: {
			id: userId,
			name: "Rate Tester",
			email: `rates@${domain}`,
			emailVerified: true,
		},
		update: {},
	});

	const company = await db.company.upsert({
		where: { domain },
		create: { name: `Money Co ${suffix}`, domain },
		update: {},
		select: { id: true },
	});
	companyId = company.id;

	await rate("EUR", "1.10", RateSource.FETCHED);
});

afterAll(async () => {
	await db.deal.deleteMany({ where: { companyId } });
	await db.company.deleteMany({ where: { domain } });
	await db.user.deleteMany({ where: { id: userId } });
	await clearRates();

	if (previousReportingCurrency) {
		await writeReportingCurrency(db, previousReportingCurrency);
	} else {
		await db.appSetting.updateMany({ data: { reportingCurrency: null } });
	}

	await conversion.rerateAll();
});

describe("a total across currencies", () => {
	it("converts on write and never adds two currencies together", async () => {
		await deals.create({
			name: `Domestic ${suffix}`,
			companyId,
			ownerId: userId,
			amountCents: MILLION,
			currency: "USD",
		});

		await deals.create({
			name: `Continental ${suffix}`,
			companyId,
			ownerId: userId,
			amountCents: MILLION,
			currency: "EUR",
		});

		expect(await pipelineCents()).toBe(MILLION + 1.1 * MILLION);
	});

	it("locks the rate onto the deal, so the row says how it was converted", async () => {
		const row = await db.deal.findFirst({
			where: { companyId, currency: "EUR" },
			select: { amount: true, baseAmount: true, fxRate: true, fxRateAt: true },
		});

		expect(row?.amount?.toNumber()).toBe(1_000_000);
		expect(row?.baseAmount?.toNumber()).toBe(1_100_000);
		expect(row?.fxRate?.toNumber()).toBe(1.1);
		expect(row?.fxRateAt).toBeInstanceOf(Date);
	});

	it("leaves a deal it cannot convert out of the total, and says so", async () => {
		const before = await pipelineCents();

		await deals.create({
			name: `Alpine ${suffix}`,
			companyId,
			ownerId: userId,
			amountCents: HALF_MILLION,
			currency: "CHF",
		});

		expect(await pipelineCents()).toBe(before);

		const summary = await dashboard.summary(userId, { scope: "me" });
		expect(summary.reportingCurrency).toBe("USD");
		expect(summary.unconverted.count).toBe(1);
		expect(summary.unconverted.currencies).toEqual(["CHF"]);
	});

	it("picks the waiting deal up when a rate finally arrives", async () => {
		await rate("CHF", "1.25", RateSource.MANUAL);

		const filled = await conversion.fillMissing();
		expect(filled.converted).toBeGreaterThan(0);

		expect(await pipelineCents()).toBe(
			MILLION + 1.1 * MILLION + 1.25 * HALF_MILLION,
		);

		const summary = await dashboard.summary(userId, { scope: "me" });
		expect(summary.unconverted.count).toBe(0);
	});

	it("does not re-rate a deal that already has a rate", async () => {
		await rate("EUR", "9.99", RateSource.FETCHED);

		await conversion.fillMissing();

		const row = await db.deal.findFirst({
			where: { companyId, currency: "EUR" },
			select: { baseAmount: true },
		});

		expect(row?.baseAmount?.toNumber()).toBe(1_100_000);
	});

	it("lets a rate entered by hand beat the fetched one on a re-rate", async () => {
		await rate("EUR", "1.50", RateSource.MANUAL);

		await conversion.rerateAll();

		const row = await db.deal.findFirst({
			where: { companyId, currency: "EUR" },
			select: { baseAmount: true, fxRate: true },
		});

		expect(row?.fxRate?.toNumber()).toBe(1.5);
		expect(row?.baseAmount?.toNumber()).toBe(1_500_000);
	});

	it("re-rates everything when the reporting currency changes", async () => {
		await writeReportingCurrency(db, "EUR");

		const rerated = await conversion.rerateAll();
		expect(rerated.missing).toContain("USD");

		const summary = await dashboard.summary(userId, { scope: "me" });

		expect(summary.reportingCurrency).toBe("EUR");
		expect(summary.pipeline.totalCents).toBe(MILLION);
		expect(summary.unconverted.currencies).toEqual(["CHF", "USD"]);
	});
});

describe("the deals list", () => {
	it("reports its open pipeline in the reporting currency and discloses the rest", async () => {
		await writeReportingCurrency(db, "USD");
		await conversion.rerateAll();

		const list = await deals.list({
			q: "",
			page: 1,
			pageSize: 25,
			sort: "amount",
			dir: "desc",
			status: "open",
			owner: userId,
			stage: "all",
			closing: "all",
		});

		expect(list.reportingCurrency).toBe("USD");
		expect(list.unconverted.count).toBe(0);
		expect(list.openValueCents).toBe(
			MILLION + 1.5 * MILLION + 1.25 * HALF_MILLION,
		);

		const amounts = list.rows.map((row) => row.baseAmountCents);
		expect(amounts).toEqual([...amounts].sort((a, b) => (b ?? 0) - (a ?? 0)));
	});
});

describe("a converted figure knows which currency it is in", () => {
	it("leaves a deal whose baseAmount predates a currency change out of totals", async () => {
		await writeReportingCurrency(db, "USD");
		await conversion.rerateAll();

		const before = await pipelineCents();
		const summary = await dashboard.summary(userId, { scope: "me" });
		expect(summary.unconverted.count).toBe(0);

		const deal = await deals.create({
			name: `Stale ${suffix}`,
			companyId,
			ownerId: userId,
			amountCents: MILLION,
			currency: "USD",
		});

		expect(await pipelineCents()).toBe(before + MILLION);

		await db.deal.update({
			where: { id: deal.id },
			data: { baseCurrency: "JPY" },
		});

		expect(await pipelineCents()).toBe(before);

		const stale = await dashboard.summary(userId, { scope: "me" });
		expect(stale.unconverted.count).toBe(1);

		const filled = await conversion.fillMissing();
		expect(filled.converted).toBeGreaterThan(0);

		expect(await pipelineCents()).toBe(before + MILLION);

		await db.deal.delete({ where: { id: deal.id } });
	});

	it("counts a currency once however it was cased or padded", async () => {
		const rows = await Promise.all(
			[" usd ", "Usd"].map((currency, index) =>
				db.deal.create({
					data: {
						name: `Variant ${index} ${suffix}`,
						companyId,
						ownerId: userId,
						amount: 1000,
						currency,
					},
					select: { id: true },
				}),
			),
		);

		const rerated = await conversion.rerateAll();

		const written = await db.deal.findMany({
			where: { id: { in: rows.map((row) => row.id) } },
			select: { baseAmount: true, baseCurrency: true },
		});

		for (const row of written) {
			expect(row.baseCurrency).toBe("USD");
			expect(row.baseAmount?.toNumber()).toBe(1000);
		}

		expect(rerated.converted).toBe(
			await db.deal.count({ where: { amount: { not: null } } }),
		);

		await db.deal.deleteMany({
			where: { id: { in: rows.map((row) => row.id) } },
		});
	});
});
