import type { Db } from "@crm/db";
import { Prisma, RateSource } from "@crm/db";
import {
	CURRENCIES,
	type CurrencyMeta,
	currencyName,
	normalizeCurrency,
} from "@crm/db/currency";
import { writeReportingCurrency } from "@crm/db/settings";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { ConversionService, type Unconverted } from "./conversion.service";
import { RatesService } from "./rates.service";

export interface CurrencyRate {
	currency: string;
	name: string | null;
	rate: number;
	asOf: string;
	source: RateSource;
	provider: string | null;
	overriding: boolean;
}

export interface CurrencyInUse {
	currency: string;
	name: string | null;
	deals: number;
	convertible: boolean;
}

export interface CurrencySettings {
	reportingCurrency: string;
	refreshedAt: string | null;
	rates: CurrencyRate[];
	inUse: CurrencyInUse[];
	unconverted: Unconverted;
	catalog: CurrencyMeta[];
}

@Injectable()
export class CurrencyService {
	private readonly logger = new Logger(CurrencyService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly conversion: ConversionService,
		private readonly rates: RatesService,
	) {}

	async settings(): Promise<CurrencySettings> {
		const reportingCurrency = await this.conversion.reportingCurrency();

		const [rows, refreshedAt, unconverted, usage] = await Promise.all([
			this.db.exchangeRate.findMany({
				where: { baseCurrency: reportingCurrency },
				select: {
					quoteCurrency: true,
					rate: true,
					asOf: true,
					source: true,
					provider: true,
				},
			}),
			this.rates.refreshedAt(),
			this.conversion.unconverted(),
			this.db.deal.groupBy({
				by: ["currency"],
				where: { amount: { not: null } },
				_count: { _all: true },
			}),
		]);

		const manual = new Set(
			rows
				.filter((row) => row.source === RateSource.MANUAL)
				.map((row) => row.quoteCurrency),
		);

		const effective = new Map<string, CurrencyRate>();

		for (const row of rows) {
			const currency = normalizeCurrency(row.quoteCurrency);

			if (row.source === RateSource.FETCHED && manual.has(row.quoteCurrency)) {
				continue;
			}

			effective.set(currency, {
				currency,
				name: currencyName(currency),
				rate: row.rate.toNumber(),
				asOf: row.asOf.toISOString(),
				source: row.source,
				provider: row.provider,
				overriding:
					row.source === RateSource.MANUAL && manual.has(row.quoteCurrency),
			});
		}

		const convertible = new Set([reportingCurrency, ...effective.keys()]);

		return {
			reportingCurrency,
			refreshedAt: refreshedAt?.toISOString() ?? null,
			rates: [...effective.values()].sort((a, b) =>
				a.currency.localeCompare(b.currency),
			),
			inUse: usage
				.map((row) => {
					const currency = normalizeCurrency(row.currency);
					return {
						currency,
						name: currencyName(currency),
						deals: row._count._all,
						convertible: convertible.has(currency),
					};
				})
				.sort(
					(a, b) => b.deals - a.deals || a.currency.localeCompare(b.currency),
				),
			unconverted,
			catalog: [...CURRENCIES],
		};
	}

	async setReportingCurrency(code: string): Promise<CurrencySettings> {
		const currency = normalizeCurrency(code);
		const current = await this.conversion.reportingCurrency();

		if (currency === current) return this.settings();

		await writeReportingCurrency(this.db, currency);

		const refresh = await this.rates.refresh();
		const rerated = await this.conversion.rerateAll();

		this.logger.log({
			message: "Reporting currency changed",
			from: current,
			to: currency,
			ratesFetched: refresh.written,
			converted: rerated.converted,
			cleared: rerated.cleared,
			missing: rerated.missing,
		});

		return this.settings();
	}

	async setManualRate(code: string, rate: number): Promise<CurrencySettings> {
		const quoteCurrency = normalizeCurrency(code);
		const baseCurrency = await this.conversion.reportingCurrency();

		if (quoteCurrency === baseCurrency) {
			throw new BadRequestException(
				`${baseCurrency} is the reporting currency — its rate is always 1.`,
			);
		}

		const asOf = new Date();

		await this.db.exchangeRate.upsert({
			where: {
				baseCurrency_quoteCurrency_source: {
					baseCurrency,
					quoteCurrency,
					source: RateSource.MANUAL,
				},
			},
			create: {
				baseCurrency,
				quoteCurrency,
				rate: new Prisma.Decimal(rate),
				asOf,
				source: RateSource.MANUAL,
			},
			update: { rate: new Prisma.Decimal(rate), asOf },
		});

		const filled = await this.conversion.fillMissing();

		this.logger.log({
			message: "Manual exchange rate saved",
			baseCurrency,
			quoteCurrency,
			converted: filled.converted,
		});

		return this.settings();
	}

	async removeManualRate(code: string): Promise<CurrencySettings> {
		const quoteCurrency = normalizeCurrency(code);
		const baseCurrency = await this.conversion.reportingCurrency();

		await this.db.exchangeRate.deleteMany({
			where: { baseCurrency, quoteCurrency, source: RateSource.MANUAL },
		});

		this.logger.log({
			message: "Manual exchange rate removed",
			baseCurrency,
			quoteCurrency,
		});

		return this.settings();
	}

	async refresh(): Promise<CurrencySettings> {
		const refresh = await this.rates.refresh();

		if (!refresh.ok) {
			throw new BadRequestException(refresh.reason ?? "Could not fetch rates.");
		}

		await this.conversion.fillMissing();

		return this.settings();
	}
}
