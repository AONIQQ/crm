import type { Db, Prisma as PrismaTypes } from "@crm/db";
import { Prisma } from "@crm/db";
import { minorUnitsOf, normalizeCurrency } from "@crm/db/currency";
import {
	applyRate,
	type Conversion,
	type ResolvedRate,
	resolveRate,
} from "@crm/db/fx";
import { readReportingCurrency } from "@crm/db/settings";
import { Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

export interface DealFxFields {
	baseAmount: PrismaTypes.Decimal | null;
	fxRate: PrismaTypes.Decimal | null;
	fxRateAt: Date | null;
}

export interface Unconverted {
	count: number;
	currencies: string[];
}

export interface RerateResult {
	converted: number;
	cleared: number;
	missing: string[];
}

@Injectable()
export class ConversionService {
	private readonly logger = new Logger(ConversionService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	async reportingCurrency(): Promise<string> {
		return readReportingCurrency(this.db);
	}

	async rateFor(currency: string): Promise<ResolvedRate | null> {
		const base = await this.reportingCurrency();
		return resolveRate(this.db, base, currency);
	}

	async convert(
		amount: PrismaTypes.Decimal | null,
		currency: string,
	): Promise<Conversion | null> {
		if (amount === null) return null;

		const base = await this.reportingCurrency();
		const rate = await resolveRate(this.db, base, currency);

		return rate ? applyRate(amount, rate, base) : null;
	}

	async dealFields(
		amount: PrismaTypes.Decimal | null,
		currency: string,
	): Promise<DealFxFields> {
		const converted = await this.convert(amount, currency);

		if (!converted) {
			return { baseAmount: null, fxRate: null, fxRateAt: null };
		}

		return {
			baseAmount: converted.baseAmount,
			fxRate: converted.fxRate,
			fxRateAt: converted.fxRateAt,
		};
	}

	async unconverted(
		where: PrismaTypes.DealWhereInput = {},
	): Promise<Unconverted> {
		const rows = await this.db.deal.groupBy({
			by: ["currency"],
			where: { ...where, amount: { not: null }, baseAmount: null },
			_count: { _all: true },
		});

		return {
			count: rows.reduce((total, row) => total + row._count._all, 0),
			currencies: rows
				.map((row) => normalizeCurrency(row.currency))
				.filter((code, index, all) => all.indexOf(code) === index)
				.sort(),
		};
	}

	async rerateAll(): Promise<RerateResult> {
		return this.rerate(false);
	}

	async fillMissing(): Promise<RerateResult> {
		return this.rerate(true);
	}

	private async rerate(onlyMissing: boolean): Promise<RerateResult> {
		const base = await this.reportingCurrency();

		const groups = await this.db.deal.groupBy({
			by: ["currency"],
			where: {
				amount: { not: null },
				...(onlyMissing ? { baseAmount: null } : {}),
			},
			_count: { _all: true },
		});

		const places = minorUnitsOf(base);
		let converted = 0;
		let cleared = 0;
		const missing: string[] = [];

		for (const group of groups) {
			const code = normalizeCurrency(group.currency);
			const rate = await resolveRate(this.db, base, code);

			if (!rate) {
				missing.push(code);

				if (!onlyMissing) {
					cleared += await this.clear(code);
				}

				continue;
			}

			converted += await this.write(code, rate, places, onlyMissing);
		}

		this.logger.log({
			message: onlyMissing
				? "Filled in deal amounts that had no rate"
				: "Re-rated every deal against the reporting currency",
			base,
			converted,
			cleared,
			missing,
		});

		return { converted, cleared, missing: missing.sort() };
	}

	private async write(
		code: string,
		rate: ResolvedRate,
		places: number,
		onlyMissing: boolean,
	): Promise<number> {
		const value = new Prisma.Decimal(rate.rate).toString();

		const filter = onlyMissing
			? Prisma.sql`AND "baseAmount" IS NULL`
			: Prisma.empty;

		return this.db.$executeRaw`
			UPDATE "deal"
			SET "baseAmount" = ROUND("amount" * ${value}::numeric, ${places}::int),
			    "fxRate" = ${value}::numeric,
			    "fxRateAt" = ${rate.asOf}
			WHERE "amount" IS NOT NULL
			  AND upper(btrim("currency")) = ${code}
			  ${filter}
		`;
	}

	private async clear(code: string): Promise<number> {
		return this.db.$executeRaw`
			UPDATE "deal"
			SET "baseAmount" = NULL, "fxRate" = NULL, "fxRateAt" = NULL
			WHERE upper(btrim("currency")) = ${code}
			  AND "baseAmount" IS NOT NULL
		`;
	}
}
