import { Module } from "@nestjs/common";
import { EnrichmentModule } from "../enrichment/enrichment.module";
import { TrpcModule } from "../trpc/trpc.module";
import { ContactsRouter } from "./contacts.router";
import { ContactsService } from "./contacts.service";

@Module({
	imports: [TrpcModule, EnrichmentModule],
	providers: [ContactsService, ContactsRouter],
	exports: [ContactsService],
})
export class ContactsModule {}
