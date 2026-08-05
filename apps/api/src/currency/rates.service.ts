import type { Db } from "@crm/db";
import { Prisma, RateSource } from "@crm/db";
import { isCurrencyCode, normalizeCurrency } from "@crm/db/currency";
import {
	readRatesRefreshedAt,
	readReportingCurrency,
	writeRatesRefreshedAt,
} from "@crm/db/settings";
import { Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

export const RATES_PROVIDER = "frankfurter.dev";

const RATES_URL = "https://api.frankfurter.dev/v1/latest";

const RATES_TIMEOUT_MS = 8_000;

export interface RateRefresh {
	ok: boolean;
	base: string;
	written: number;
	asOf: string | null;
	reason: string | null;
}

interface FrankfurterResponse {
	base?: unknown;
	date?: unknown;
	rates?: Record<string, unknown>;
}

function parseAsOf(value: unknown): Date | null {
	if (typeof value !== "string") return null;
	const date = new Date(`${value}T00:00:00.000Z`);
	return Number.isNaN(date.getTime()) ? null : date;
}

@Injectable()
export class RatesService {
	private readonly logger = new Logger(RatesService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	async refreshedAt(): Promise<Date | null> {
		return readRatesRefreshedAt(this.db);
	}

	async refresh(): Promise<RateRefresh> {
		const base = await readReportingCurrency(this.db);
		const quotes = await this.fetch(base);

		if (!quotes) {
			return {
				ok: false,
				base,
				written: 0,
				asOf: null,
				reason: `Could not reach ${RATES_PROVIDER}. Rates entered by hand are unaffected.`,
			};
		}

		const written = await this.store(base, quotes.rates, quotes.asOf);

		await writeRatesRefreshedAt(this.db, new Date());

		this.logger.log({
			message: "Exchange rates refreshed",
			base,
			written,
			asOf: quotes.asOf.toISOString(),
		});

		return {
			ok: true,
			base,
			written,
			asOf: quotes.asOf.toISOString(),
			reason: null,
		};
	}

	private async store(
		base: string,
		rates: Map<string, Prisma.Decimal>,
		asOf: Date,
	): Promise<number> {
		let written = 0;

		for (const [quoteCurrency, rate] of rates) {
			await this.db.exchangeRate.upsert({
				where: {
					baseCurrency_quoteCurrency_source: {
						baseCurrency: base,
						quoteCurrency,
						source: RateSource.FETCHED,
					},
				},
				create: {
					baseCurrency: base,
					quoteCurrency,
					rate,
					asOf,
					source: RateSource.FETCHED,
					provider: RATES_PROVIDER,
				},
				update: { rate, asOf, provider: RATES_PROVIDER },
			});

			written += 1;
		}

		return written;
	}

	private async fetch(
		base: string,
	): Promise<{ rates: Map<string, Prisma.Decimal>; asOf: Date } | null> {
		try {
			const response = await fetch(
				`${RATES_URL}?base=${encodeURIComponent(base)}`,
				{
					headers: { accept: "application/json" },
					signal: AbortSignal.timeout(RATES_TIMEOUT_MS),
				},
			);

			if (!response.ok) {
				this.logger.warn({
					message: "Exchange rate request failed",
					status: response.status,
					base,
				});
				return null;
			}

			const body = (await response.json()) as FrankfurterResponse;
			const asOf = parseAsOf(body.date) ?? new Date();
			const rates = new Map<string, Prisma.Decimal>();

			for (const [code, value] of Object.entries(body.rates ?? {})) {
				const quoteCurrency = normalizeCurrency(code);
				if (!isCurrencyCode(quoteCurrency)) continue;
				if (quoteCurrency === normalizeCurrency(base)) continue;

				const perBase = Number(value);
				if (!Number.isFinite(perBase) || perBase <= 0) continue;

				rates.set(
					quoteCurrency,
					new Prisma.Decimal(1).dividedBy(perBase).toDecimalPlaces(10),
				);
			}

			if (rates.size === 0) {
				this.logger.warn({
					message: "Exchange rate response carried no usable rates",
					base,
				});
				return null;
			}

			return { rates, asOf };
		} catch (error) {
			this.logger.warn({
				message: "Exchange rates unavailable",
				base,
				reason: error instanceof Error ? error.message : String(error),
			});
			return null;
		}
	}
}
