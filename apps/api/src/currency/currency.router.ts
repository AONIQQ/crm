import { Inject } from "@nestjs/common";
import { Input, Mutation, Query, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import {
	removeManualRateInput,
	setManualRateInput,
	setReportingCurrencyInput,
} from "./currency.contracts";
import { CurrencyService } from "./currency.service";

@Router({ alias: "currency" })
@UseMiddlewares(AuthMiddleware)
export class CurrencyRouter {
	constructor(
		@Inject(CurrencyService) private readonly currency: CurrencyService,
	) {}

	@Query()
	async settings() {
		return this.currency.settings();
	}

	@Mutation({ input: setReportingCurrencyInput })
	async setReportingCurrency(
		@Input() input: z.infer<typeof setReportingCurrencyInput>,
	) {
		return this.currency.setReportingCurrency(input.currency);
	}

	@Mutation({ input: setManualRateInput })
	async setManualRate(@Input() input: z.infer<typeof setManualRateInput>) {
		return this.currency.setManualRate(input.currency, input.rate);
	}

	@Mutation({ input: removeManualRateInput })
	async removeManualRate(
		@Input() input: z.infer<typeof removeManualRateInput>,
	) {
		return this.currency.removeManualRate(input.currency);
	}

	@Mutation()
	async refreshRates() {
		return this.currency.refresh();
	}
}
