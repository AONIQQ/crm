import { Injectable } from "@nestjs/common";
import { GoogleApiClient, type GoogleResult } from "./google-api.client";
import type { GmailPart } from "./mime";

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export type GmailMessage = {
	id?: string;
	threadId?: string;
	labelIds?: string[];
	snippet?: string;
	internalDate?: string;
	historyId?: string;
	payload?: GmailPart;
};

export type MessageList = {
	messages?: { id?: string; threadId?: string }[];
	nextPageToken?: string;
	resultSizeEstimate?: number;
};

export type HistoryList = {
	history?: {
		id?: string;
		messagesAdded?: { message?: { id?: string; threadId?: string } }[];
	}[];
	nextPageToken?: string;
	historyId?: string;
};

export type Profile = {
	emailAddress?: string;
	historyId?: string;
};

/**
 * The Gmail query used for every backfill page.
 *
 * Narrowing here rather than after fetching is the difference between reading a
 * mailbox and reading the part of it that could possibly be work. Promotions,
 * social and chats are never customer conversations, and each excluded message
 * is a `messages.get` we do not pay for.
 */
export const WORK_MAIL_QUERY =
	"-in:chats -category:promotions -category:social -category:forums";

@Injectable()
export class GmailClient {
	constructor(private readonly api: GoogleApiClient) {}

	/** The mailbox's own address and current historyId — the backfill anchor. */
	async profile(accessToken: string): Promise<GoogleResult<Profile>> {
		return this.api.get<Profile>(`${BASE}/profile`, accessToken);
	}

	/** Message ids in a time window, newest first. */
	async listMessages(
		accessToken: string,
		options: {
			after: Date;
			before: Date;
			pageToken?: string;
			maxResults?: number;
		},
	): Promise<GoogleResult<MessageList>> {
		// Gmail's `after`/`before` take seconds since the epoch.
		const after = Math.floor(options.after.getTime() / 1000);
		const before = Math.ceil(options.before.getTime() / 1000);

		return this.api.get<MessageList>(`${BASE}/messages`, accessToken, {
			q: `${WORK_MAIL_QUERY} after:${after} before:${before}`,
			maxResults: options.maxResults ?? 100,
			pageToken: options.pageToken,
		});
	}

	/**
	 * Changes since a historyId.
	 *
	 * A `startHistoryId` older than Gmail's retention window (documented as
	 * "typically at least one week") comes back as 404, which
	 * `GoogleApiClient` surfaces as `cursor-invalid`.
	 */
	async listHistory(
		accessToken: string,
		options: { startHistoryId: string; pageToken?: string },
	): Promise<GoogleResult<HistoryList>> {
		return this.api.get<HistoryList>(`${BASE}/history`, accessToken, {
			startHistoryId: options.startHistoryId,
			historyTypes: "messageAdded",
			maxResults: 500,
			pageToken: options.pageToken,
		});
	}

	/** One message, with headers and body. */
	async getMessage(
		accessToken: string,
		id: string,
	): Promise<GoogleResult<GmailMessage>> {
		return this.api.get<GmailMessage>(`${BASE}/messages/${id}`, accessToken, {
			format: "full",
		});
	}
}
