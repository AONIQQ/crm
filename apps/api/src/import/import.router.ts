import { Inject } from "@nestjs/common";
import { Input, Mutation, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { importInput } from "./import.contracts";
import { ImportService } from "./import.service";

@Router({ alias: "import" })
@UseMiddlewares(AuthMiddleware)
export class ImportRouter {
	constructor(@Inject(ImportService) private readonly imports: ImportService) {}

	/**
	 * A mutation even when `dryRun` is true.
	 *
	 * A dry run writes nothing, but it is a POST with a body the size of a
	 * spreadsheet, and modelling it as a query would put the whole file in a URL
	 * and in the query cache.
	 */
	@Mutation({ input: importInput })
	async run(@Input() input: z.infer<typeof importInput>) {
		return this.imports.run(input);
	}
}
