import { Module } from "@nestjs/common";
import { EnrichmentModule } from "../enrichment/enrichment.module";
import { TrpcModule } from "../trpc/trpc.module";
import { CalendarClient } from "./calendar.client";
import { CalendarSyncService } from "./calendar-sync.service";
import { ConversationService } from "./conversation.service";
import { GmailClient } from "./gmail.client";
import { GmailSyncService } from "./gmail-sync.service";
import { GoogleRouter } from "./google.router";
import { GoogleApiClient } from "./google-api.client";
import { GoogleConnectionService } from "./google-connection.service";
import { GoogleMatchService } from "./google-match.service";
import { GoogleSyncService } from "./google-sync.service";
import { GoogleTokenService } from "./google-token.service";
import { SyncController } from "./sync.controller";
import { SyncStateService } from "./sync-state.service";

/**
 * Gmail and Calendar.
 *
 * Depends on `EnrichmentModule` for one thing only: `companyForEmail`, which
 * already turns a work address into a found-or-created, enrichment-queued
 * company. Auto-creation reusing it is what makes an auto-created company
 * arrive with a logo rather than as a bare domain.
 */
@Module({
	imports: [TrpcModule, EnrichmentModule],
	controllers: [SyncController],
	providers: [
		GoogleApiClient,
		GoogleTokenService,
		SyncStateService,
		GoogleMatchService,
		CalendarClient,
		CalendarSyncService,
		GmailClient,
		GmailSyncService,
		GoogleSyncService,
		GoogleConnectionService,
		ConversationService,
		GoogleRouter,
	],
	exports: [GoogleSyncService, GoogleConnectionService],
})
export class GoogleModule {}
