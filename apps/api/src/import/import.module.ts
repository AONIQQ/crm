import { Module } from "@nestjs/common";
import { EnrichmentModule } from "../enrichment/enrichment.module";
import { TrpcModule } from "../trpc/trpc.module";
import { ImportRouter } from "./import.router";
import { ImportService } from "./import.service";

@Module({
	imports: [TrpcModule, EnrichmentModule],
	providers: [ImportService, ImportRouter],
})
export class ImportModule {}
