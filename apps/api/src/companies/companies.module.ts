import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { TrpcModule } from "../trpc/trpc.module";
import { CompaniesRouter } from "./companies.router";
import { CompaniesService } from "./companies.service";
import { CompanyDirectoryService } from "./company-directory.service";

@Module({
	imports: [TrpcModule, AgentModule],
	providers: [CompaniesService, CompanyDirectoryService, CompaniesRouter],
	exports: [CompaniesService, CompanyDirectoryService],
})
export class CompaniesModule {}
