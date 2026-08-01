import {
	ActivityType,
	type Db,
	EmailDirection,
	GoogleSyncStatus,
	type MailboxSyncModel as MailboxSync,
	RecordSource,
} from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { ActivityStampService } from "../crm/activity-stamp.service";
import { InjectDatabase } from "../database/database.constants";
import { GmailClient, type GmailMessage } from "./gmail.client";
import { GoogleMatchService, type MatchContext } from "./google-match.service";
import { GoogleTokenService } from "./google-token.service";
import {
	type GmailHeader,
	header,
	normaliseMessageId,
	plainTextBody,
	rootMessageId,
	snippetOf,
	stripQuotedHistory,
} from "./mime";
import {
	type Participant,
	parseAddress,
	parseAddressList,
} from "./participants";
import { SyncStateService } from "./sync-state.service";

/** Ceiling on one tick, so a burst of mail cannot stretch an invocation. */
const MAX_MESSAGES_PER_TICK = 120;

export type GmailSyncOutcome = {
	source: "gmail";
	userId: string;
	status: "synced" | "skipped" | "reconnect" | "rate-limited" | "failed";
	messagesWritten?: number;
	threadsTouched?: number;
	reason?: string;
};

/** A message parsed into the shape the database wants. */
type ParsedMessage = {
	rfcMessageId: string;
	rootId: string;
	subject: string | null;
	from: Participant;
	recipients: { email: string; name: string | null; kind: "to" | "cc" }[];
	body: string;
	sentAt: Date;
	gmailMessageId: string | null;
};

/**
 * Gmail → `EmailThread`/`EmailMessage` → one projected `Activity` per thread.
 *
 * The two things that make this harder than calendar: identity has to be
 * derived from RFC headers rather than handed to us, and a reply carries the
 * whole conversation in its body, so what gets stored needs pruning first.
 */
@Injectable()
export class GmailSyncService {
	private readonly logger = new Logger(GmailSyncService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly gmail: GmailClient,
		private readonly tokens: GoogleTokenService,
		private readonly match: GoogleMatchService,
		private readonly state: SyncStateService,
		private readonly stamp: ActivityStampService,
	) {}

	async sync(row: MailboxSync): Promise<GmailSyncOutcome> {
		const token = await this.tokens.accessTokenFor(row.userId, "gmail");

		if (token.outcome === "not-connected") {
			return {
				source: "gmail",
				userId: row.userId,
				status: "skipped",
				reason: token.reason,
			};
		}

		if (token.outcome === "needs-reconnect") {
			await this.state.markNeedsReconnect(row.id, token.reason);
			return {
				source: "gmail",
				userId: row.userId,
				status: "reconnect",
				reason: token.reason,
			};
		}

		await this.state.markRunning(row.id);

		// Whose mailbox this is, so a message can be classed inbound or outbound
		// and so "did the rep reply?" is answerable.
		const profile = await this.gmail.profile(token.accessToken);
		if (profile.outcome !== "ok") {
			return this.handleFailure(row, profile, "gmail");
		}

		const mailbox = profile.data.emailAddress?.toLowerCase() ?? null;
		if (!mailbox) {
			await this.state.markFailed(row.id, "Gmail returned no mailbox address.");
			return {
				source: "gmail",
				userId: row.userId,
				status: "failed",
				reason: "No mailbox address.",
			};
		}

		// No cursor means this mailbox has never been seen. Sync is forward-only,
		// so the first pass imports nothing at all — it just records where "now"
		// is, and everything after that point arrives through `incremental`.
		if (!row.cursor) {
			return this.start(row, profile.data.historyId ?? null);
		}

		return this.incremental(row, token.accessToken, mailbox, row.cursor);
	}

	/**
	 * Marks the starting line.
	 *
	 * Deliberately imports nothing. A CRM that suddenly fills with three months
	 * of a rep's old mail is noise nobody asked for, and the history is not what
	 * the feature is for — what matters is that from this moment on, the
	 * conversation shows up on the record.
	 */
	private async start(
		row: MailboxSync,
		historyId: string | null,
	): Promise<GmailSyncOutcome> {
		if (!historyId) {
			await this.state.markFailed(row.id, "Gmail returned no historyId.");
			return {
				source: "gmail",
				userId: row.userId,
				status: "failed",
				reason: "No historyId to start from.",
			};
		}

		await this.state.settle(row.id, {
			cursor: historyId,
			status: GoogleSyncStatus.RUNNING,
		});

		this.logger.log({
			message: "Gmail sync started — watching for new mail",
			userId: row.userId,
		});

		return { source: "gmail", userId: row.userId, status: "synced" };
	}

	/** Everything added since the stored historyId. */
	private async incremental(
		row: MailboxSync,
		accessToken: string,
		mailbox: string,
		startHistoryId: string,
	): Promise<GmailSyncOutcome> {
		const history = await this.gmail.listHistory(accessToken, {
			startHistoryId,
		});

		if (history.outcome === "cursor-invalid") {
			// The historyId fell out of Gmail's retention window — which takes about
			// a week of the sync not running at all. Forward-only means we do not
			// go back and fetch the gap: the cursor is re-pointed at now and the
			// missed window is simply not imported. Logged, because a mailbox that
			// keeps landing here is a sync that keeps failing.
			await this.state.clearCursor(row.id, history.reason);

			return {
				source: "gmail",
				userId: row.userId,
				status: "synced",
				reason: "History expired; resuming from now.",
			};
		}

		if (history.outcome !== "ok") {
			return this.handleFailure(row, history, "gmail");
		}

		const ids = new Set<string>();
		for (const entry of history.data.history ?? []) {
			for (const added of entry.messagesAdded ?? []) {
				if (added.message?.id) ids.add(added.message.id);
			}
		}

		const { written, remaining } = await this.ingest(
			row,
			accessToken,
			mailbox,
			[...ids],
		);

		await this.state.settle(row.id, {
			// Hold the cursor when the batch was capped. Advancing past messages we
			// never read would drop them permanently; leaving it means the next tick
			// re-lists the same window, finds this run's writes already stored, and
			// works through the next hundred.
			cursor:
				remaining > 0
					? startHistoryId
					: (history.data.historyId ?? startHistoryId),
			status: GoogleSyncStatus.RUNNING,
		});

		if (written > 0 || remaining > 0) {
			this.logger.log({
				message: "Gmail incremental sync",
				userId: row.userId,
				messagesWritten: written,
				remaining,
			});
		}

		return {
			source: "gmail",
			userId: row.userId,
			status: "synced",
			messagesWritten: written,
		};
	}

	/**
	 * Fetches and stores message ids, up to this tick's ceiling.
	 *
	 * Reports what it could not get to, so the caller knows whether it is safe to
	 * advance the cursor. Filtering the already-stored ids out *before* taking the
	 * batch is what makes a capped run make progress: otherwise every tick would
	 * re-take the same first hundred, find them all present, and write nothing.
	 */
	private async ingest(
		row: MailboxSync,
		accessToken: string,
		mailbox: string,
		ids: readonly string[],
	): Promise<{ written: number; remaining: number }> {
		if (ids.length === 0) return { written: 0, remaining: 0 };

		// The unique index on `rfcMessageId` is the backstop, but checking Gmail's
		// own id first avoids paying for a `messages.get` on something another
		// rep's sync already ingested.
		const alreadyHave = await this.db.emailMessage.findMany({
			where: { gmailMessageId: { in: [...ids] } },
			select: { gmailMessageId: true },
		});
		const seen = new Set(
			alreadyHave.map((existing) => existing.gmailMessageId),
		);

		const pending = ids.filter((id) => !seen.has(id));
		const batch = pending.slice(0, MAX_MESSAGES_PER_TICK);
		const remaining = pending.length - batch.length;

		if (batch.length === 0) return { written: 0, remaining };

		const [internal, suppressedDomains] = await Promise.all([
			this.match.internalIdentity(),
			this.match.suppressedDomains(),
		]);

		const context = {
			ourAddresses: internal.addresses,
			ourDomains: internal.domains,
			suppressedDomains,
		};

		let written = 0;

		for (const id of batch) {
			const message = await this.gmail.getMessage(accessToken, id);
			if (message.outcome !== "ok") continue;

			const stored = await this.store(row, mailbox, message.data, context);
			if (stored) written += 1;
		}

		return { written, remaining };
	}

	/** One message: match it, store it, keep its thread's projection current. */
	private async store(
		row: MailboxSync,
		mailbox: string,
		message: GmailMessage,
		context: MatchContext,
	): Promise<boolean> {
		const parsed = this.parse(message);
		if (!parsed) return false;

		// Already ingested from another mailbox. The unique index would catch this
		// anyway; checking first keeps the log honest about what was written.
		const existing = await this.db.emailMessage.findUnique({
			where: { rfcMessageId: parsed.rfcMessageId },
			select: { id: true },
		});
		if (existing) return false;

		const participants = [parsed.from, ...parsed.recipients];
		const outbound = parsed.from.email === mailbox;

		// The thread may already exist from an earlier message, in which case its
		// match is authoritative and the whole resolve step is skipped.
		const thread = await this.db.emailThread.findUnique({
			where: { rootMessageId: parsed.rootId },
			select: { id: true, companyId: true, contactId: true },
		});

		let companyId = thread?.companyId ?? null;
		let contactId = thread?.contactId ?? null;

		if (!thread) {
			// Two-way engagement: the rep has to have sent something. An inbound-only
			// thread is a newsletter, a recruiter or spam, and creating a company
			// from one is how a CRM fills with junk.
			const repliedTo =
				outbound || (await this.hasOutboundInThread(parsed.rootId, mailbox));

			const match = await this.match.resolve(
				{
					participants,
					allowCreate: row.autoCreate && repliedTo,
					source: RecordSource.EMAIL,
					// Whoever's mailbox this is owns what it creates.
					ownerId: row.userId,
				},
				context,
			);

			companyId = match.companyId;
			contactId = match.contactId;

			if (!companyId && !contactId) {
				// Not anybody we track and not worth creating. Dropped at ingest —
				// never written, per the plan §5.
				return false;
			}
		}

		const record = await this.db.emailThread.upsert({
			where: { rootMessageId: parsed.rootId },
			create: {
				rootMessageId: parsed.rootId,
				subject: parsed.subject,
				companyId,
				contactId,
				firstMessageAt: parsed.sentAt,
				lastMessageAt: parsed.sentAt,
				messageCount: 0,
			},
			update: {},
			select: { id: true, firstMessageAt: true, lastMessageAt: true },
		});

		await this.db.emailMessage.create({
			data: {
				threadId: record.id,
				rfcMessageId: parsed.rfcMessageId,
				syncedByUserId: row.userId,
				gmailMessageId: parsed.gmailMessageId,
				direction: outbound ? EmailDirection.OUTBOUND : EmailDirection.INBOUND,
				fromEmail: parsed.from.email,
				fromName: parsed.from.name,
				recipients: parsed.recipients,
				subject: parsed.subject,
				snippet: snippetOf(parsed.body),
				body: parsed.body || null,
				sentAt: parsed.sentAt,
			},
		});

		// Recomputed rather than incremented: messages arriving out of order would
		// otherwise leave `lastMessageAt` pointing at whichever message happened to
		// arrive last, which is not the same as the latest one.
		const stats = await this.db.emailMessage.aggregate({
			where: { threadId: record.id },
			_count: { _all: true },
			_min: { sentAt: true },
			_max: { sentAt: true },
		});

		const firstMessageAt = stats._min.sentAt ?? parsed.sentAt;
		const lastMessageAt = stats._max.sentAt ?? parsed.sentAt;

		await this.db.emailThread.update({
			where: { id: record.id },
			data: {
				messageCount: stats._count._all,
				firstMessageAt,
				lastMessageAt,
				// A thread's subject is the one it started with, not the "Re: Re: Fwd:"
				// it acquired.
				...(parsed.sentAt <= firstMessageAt ? { subject: parsed.subject } : {}),
			},
		});

		await this.project(record.id, row.userId, {
			subject: parsed.subject ?? "(no subject)",
			snippet: snippetOf(parsed.body),
			lastMessageAt,
			companyId,
			contactId,
		});

		return true;
	}

	/** Whether the mailbox owner has sent anything into this thread already. */
	private async hasOutboundInThread(
		rootMessageId: string,
		mailbox: string,
	): Promise<boolean> {
		const found = await this.db.emailMessage.findFirst({
			where: {
				thread: { rootMessageId },
				fromEmail: mailbox,
			},
			select: { id: true },
		});

		return found !== null;
	}

	/**
	 * One `Activity` per thread, updated as the thread grows.
	 *
	 * Not one per message: a forty-message thread would otherwise be forty
	 * timeline rows saying almost the same thing.
	 */
	private async project(
		emailThreadId: string,
		userId: string,
		summary: {
			subject: string;
			snippet: string | null;
			lastMessageAt: Date;
			companyId: string | null;
			contactId: string | null;
		},
	): Promise<void> {
		const activity = await this.db.activity.upsert({
			where: { emailThreadId },
			create: {
				type: ActivityType.EMAIL,
				subject: summary.subject,
				body: summary.snippet,
				occurredAt: summary.lastMessageAt,
				companyId: summary.companyId,
				contactId: summary.contactId,
				createdById: userId,
				emailThreadId,
				meta: { synced: true, source: "gmail" },
			},
			update: {
				body: summary.snippet,
				occurredAt: summary.lastMessageAt,
			},
			select: { createdAt: true },
		});

		await this.stamp.touch(
			{ companyId: summary.companyId, contactId: summary.contactId },
			activity.createdAt,
		);
	}

	/** Gmail's message resource → the fields we store. */
	private parse(message: GmailMessage): ParsedMessage | null {
		const headers = message.payload?.headers;

		const rawMessageId = header(headers, "message-id");
		if (!rawMessageId) return null;

		const from = parseAddress(header(headers, "from") ?? "");
		if (!from) return null;

		const sentAt = this.sentAt(message, headers);
		if (!sentAt) return null;

		const rootId = rootMessageId(headers) ?? normaliseMessageId(rawMessageId);

		const to = parseAddressList(header(headers, "to")).map((person) => ({
			email: person.email,
			name: person.name,
			kind: "to" as const,
		}));

		const cc = parseAddressList(header(headers, "cc")).map((person) => ({
			email: person.email,
			name: person.name,
			kind: "cc" as const,
		}));

		const body = stripQuotedHistory(plainTextBody(message.payload));

		return {
			rfcMessageId: normaliseMessageId(rawMessageId),
			rootId,
			subject: header(headers, "subject"),
			from,
			recipients: [...to, ...cc],
			body,
			sentAt,
			gmailMessageId: message.id ?? null,
		};
	}

	private sentAt(
		message: GmailMessage,
		headers: readonly GmailHeader[] | undefined,
	): Date | null {
		// `internalDate` is Gmail's own receipt time in ms and is always present
		// and always parseable; the `Date` header is neither.
		if (message.internalDate) {
			const at = new Date(Number(message.internalDate));
			if (!Number.isNaN(at.getTime())) return at;
		}

		const raw = header(headers, "date");
		if (!raw) return null;

		const at = new Date(raw);
		return Number.isNaN(at.getTime()) ? null : at;
	}

	private async handleFailure(
		row: MailboxSync,
		result: { outcome: string; reason: string; retryAfterMs?: number },
		source: "gmail",
	): Promise<GmailSyncOutcome> {
		if (result.outcome === "unauthorized") {
			await this.state.markNeedsReconnect(row.id, result.reason);
			return {
				source,
				userId: row.userId,
				status: "reconnect",
				reason: result.reason,
			};
		}

		if (result.outcome === "rate-limited") {
			await this.state.markRateLimited(row.id, result.retryAfterMs ?? 60_000);
			return {
				source,
				userId: row.userId,
				status: "rate-limited",
				reason: result.reason,
			};
		}

		await this.state.markFailed(row.id, result.reason);
		return {
			source,
			userId: row.userId,
			status: "failed",
			reason: result.reason,
		};
	}
}
