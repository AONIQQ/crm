import { Module } from "@nestjs/common";
import { EnrichmentModule } from "../enrichment/enrichment.module";
import { TrpcModule } from "../trpc/trpc.module";
import { CompaniesRouter } from "./companies.router";
import { CompaniesService } from "./companies.service";

@Module({
	imports: [TrpcModule, EnrichmentModule],
	providers: [CompaniesService, CompaniesRouter],
	exports: [CompaniesService],
})
export class CompaniesModule {}
