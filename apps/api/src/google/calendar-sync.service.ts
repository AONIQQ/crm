import {
	ActivityType,
	type Db,
	GoogleSyncStatus,
	type MailboxSyncModel as MailboxSync,
	RecordSource,
} from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { ActivityStampService } from "../crm/activity-stamp.service";
import { InjectDatabase } from "../database/database.constants";
import {
	CalendarClient,
	conferenceUrl,
	eventTime,
	type GoogleEvent,
} from "./calendar.client";
import { GoogleMatchService, type MatchContext } from "./google-match.service";
import { GoogleTokenService } from "./google-token.service";
import type { Participant } from "./participants";
import { SyncStateService } from "./sync-state.service";

/** How many pages one cron tick will pull before yielding. */
const MAX_PAGES_PER_TICK = 5;

/** How far forward to look. Meetings matter before they happen. */
const HORIZON_DAYS = 180;

export type SyncOutcome = {
	source: "calendar";
	userId: string;
	status: "synced" | "skipped" | "reconnect" | "rate-limited" | "failed";
	eventsWritten?: number;
	eventsRemoved?: number;
	reason?: string;
};

/**
 * Google Calendar → `CalendarEvent` → a projected `Activity` on the timeline.
 *
 * Calendar is the simpler of the two syncs and was built first deliberately: the
 * dedupe key is handed to us, there are no bodies to parse, and it proves the
 * whole connect → cron → match → project → render path before Gmail adds its
 * own problems.
 */
@Injectable()
export class CalendarSyncService {
	private readonly logger = new Logger(CalendarSyncService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly calendar: CalendarClient,
		private readonly tokens: GoogleTokenService,
		private readonly match: GoogleMatchService,
		private readonly state: SyncStateService,
		private readonly stamp: ActivityStampService,
	) {}

	async sync(row: MailboxSync): Promise<SyncOutcome> {
		const token = await this.tokens.accessTokenFor(row.userId, "calendar");

		if (token.outcome === "not-connected") {
			return {
				source: "calendar",
				userId: row.userId,
				status: "skipped",
				reason: token.reason,
			};
		}

		if (token.outcome === "needs-reconnect") {
			await this.state.markNeedsReconnect(row.id, token.reason);
			return {
				source: "calendar",
				userId: row.userId,
				status: "reconnect",
				reason: token.reason,
			};
		}

		await this.state.markRunning(row.id);

		const [internal, suppressedDomains] = await Promise.all([
			this.match.internalIdentity(),
			this.match.suppressedDomains(),
		]);

		const context = {
			ourAddresses: internal.addresses,
			ourDomains: internal.domains,
			suppressedDomains,
		};

		let pageToken: string | undefined;
		let syncToken = row.cursor ?? undefined;
		let written = 0;
		let removed = 0;

		for (let page = 0; page < MAX_PAGES_PER_TICK; page += 1) {
			const result = await this.calendar.listEvents(token.accessToken, {
				syncToken,
				pageToken,
				// Only meaningful on a full pass; ignored when a syncToken is set.
				//
				// `now`, never earlier: past meetings are not imported. Events that
				// *start* from now on are, though, including ones booked before the
				// sync was switched on — a meeting in next Tuesday's diary is the
				// point of the feature, and putting it on the timeline is not
				// back-dating anything.
				timeMin: new Date().toISOString(),
				timeMax: this.horizon().toISOString(),
			});

			if (result.outcome === "cursor-invalid") {
				await this.state.clearCursor(row.id, result.reason);
				return {
					source: "calendar",
					userId: row.userId,
					status: "synced",
					eventsWritten: written,
					eventsRemoved: removed,
					reason: "Cursor reset; the next tick re-runs the window.",
				};
			}

			if (result.outcome === "unauthorized") {
				await this.state.markNeedsReconnect(row.id, result.reason);
				return {
					source: "calendar",
					userId: row.userId,
					status: "reconnect",
					reason: result.reason,
				};
			}

			if (result.outcome === "rate-limited") {
				await this.state.markRateLimited(row.id, result.retryAfterMs);
				return {
					source: "calendar",
					userId: row.userId,
					status: "rate-limited",
					reason: result.reason,
				};
			}

			if (result.outcome === "failed") {
				await this.state.markFailed(row.id, result.reason);
				return {
					source: "calendar",
					userId: row.userId,
					status: "failed",
					reason: result.reason,
				};
			}

			for (const event of result.data.items ?? []) {
				const applied = await this.apply(event, row, context);
				if (applied === "written") written += 1;
				if (applied === "removed") removed += 1;
			}

			pageToken = result.data.nextPageToken;

			if (!pageToken) {
				// The sync token only appears on the final page; that is the signal
				// the window is fully drained and steady-state can begin.
				syncToken = result.data.nextSyncToken ?? syncToken;
				await this.state.settle(row.id, {
					cursor: syncToken ?? null,
					status: GoogleSyncStatus.RUNNING,
				});

				this.logger.log({
					message: "Calendar sync complete",
					userId: row.userId,
					eventsWritten: written,
					eventsRemoved: removed,
				});

				return {
					source: "calendar",
					userId: row.userId,
					status: "synced",
					eventsWritten: written,
					eventsRemoved: removed,
				};
			}
		}

		// Ran out of page budget without reaching the last page, so there is no
		// sync token to keep. The next tick re-runs the window, which is free
		// because every write is an upsert on a natural key.
		await this.state.settle(row.id, {
			status: GoogleSyncStatus.IDLE,
		});

		return {
			source: "calendar",
			userId: row.userId,
			status: "synced",
			eventsWritten: written,
			eventsRemoved: removed,
			reason: "Page budget reached; continuing next tick.",
		};
	}

	/**
	 * One event: store it, project it, or delete what we stored before.
	 *
	 * Returns what it did so the caller can count without a second pass.
	 */
	private async apply(
		event: GoogleEvent,
		row: MailboxSync,
		context: MatchContext,
	): Promise<"written" | "removed" | "ignored"> {
		const iCalUid = event.iCalUID;
		if (!iCalUid) return "ignored";

		const start = eventTime(event.start);
		const originalStart = eventTime(event.originalStartTime) ?? start;

		// An instance keeps its original start even when moved, which is what
		// identifies it within a recurring series.
		if (!originalStart) return "ignored";

		const key = {
			iCalUid_originalStartTime: {
				iCalUid,
				originalStartTime: originalStart.at,
			},
		};

		if (event.status === "cancelled") {
			// Cancellations arrive as ordinary items because we ask for
			// showDeleted. Deleting cascades to the projected activity.
			const deleted = await this.db.calendarEvent.deleteMany({
				where: {
					iCalUid,
					originalStartTime: originalStart.at,
				},
			});
			return deleted.count > 0 ? "removed" : "ignored";
		}

		const end = eventTime(event.end);
		if (!start || !end) return "ignored";

		const participants = this.participantsOf(event);

		// A meeting is two-way engagement on its own: somebody put time in a
		// diary. So calendar may create, subject to the row's own toggle.
		const declinedByUs = event.attendees?.some(
			(attendee) => attendee.self && attendee.responseStatus === "declined",
		);

		const match = await this.match.resolve(
			{
				participants,
				allowCreate: row.autoCreate && !declinedByUs,
				source: RecordSource.CALENDAR,
				// Whoever's calendar this is owns what it creates — they are the
				// person with the relationship.
				ownerId: row.userId,
			},
			context,
		);

		if (!match.companyId && !match.contactId) {
			// Nothing we track, and nothing worth creating — a dentist appointment.
			// Never stored, per the plan §5.
			return "ignored";
		}

		const organizer = event.organizer?.email?.toLowerCase() ?? null;

		const record = await this.db.calendarEvent.upsert({
			where: key,
			create: {
				iCalUid,
				originalStartTime: originalStart.at,
				recurringEventId: event.recurringEventId ?? null,
				title: event.summary ?? null,
				description: event.description ?? null,
				location: event.location ?? null,
				conferenceUrl: conferenceUrl(event),
				startsAt: start.at,
				endsAt: end.at,
				isAllDay: start.isAllDay,
				status: event.status ?? "confirmed",
				organizerEmail: organizer,
				companyId: match.companyId,
				contactId: match.contactId,
				syncedByUserId: row.userId,
				googleEventId: event.id ?? null,
			},
			update: {
				title: event.summary ?? null,
				description: event.description ?? null,
				location: event.location ?? null,
				conferenceUrl: conferenceUrl(event),
				startsAt: start.at,
				endsAt: end.at,
				isAllDay: start.isAllDay,
				status: event.status ?? "confirmed",
				organizerEmail: organizer,
				companyId: match.companyId,
				contactId: match.contactId,
			},
			select: { id: true },
		});

		await this.syncAttendees(record.id, event);
		await this.project(record.id, row.userId, {
			title: event.summary ?? "Meeting",
			startsAt: start.at,
			companyId: match.companyId,
			contactId: match.contactId,
			location: event.location ?? null,
		});

		return "written";
	}

	/** Replaces the attendee list, linking anyone we already know as a contact. */
	private async syncAttendees(
		eventId: string,
		event: GoogleEvent,
	): Promise<void> {
		const attendees = (event.attendees ?? []).filter(
			// Meeting rooms are attendees as far as Google is concerned.
			(attendee) => attendee.email && !attendee.resource,
		);

		if (attendees.length === 0) return;

		const emails = attendees.map((attendee) =>
			(attendee.email as string).toLowerCase(),
		);

		const contacts = await this.db.contact.findMany({
			where: { email: { in: emails } },
			select: { id: true, email: true },
		});

		const contactByEmail = new Map(
			contacts.map((contact) => [contact.email as string, contact.id]),
		);

		for (const attendee of attendees) {
			const email = (attendee.email as string).toLowerCase();

			await this.db.calendarAttendee.upsert({
				where: { eventId_email: { eventId, email } },
				create: {
					eventId,
					email,
					name: attendee.displayName ?? null,
					responseStatus: attendee.responseStatus ?? null,
					isOrganizer: attendee.organizer ?? false,
					contactId: contactByEmail.get(email) ?? null,
				},
				update: {
					name: attendee.displayName ?? null,
					responseStatus: attendee.responseStatus ?? null,
					isOrganizer: attendee.organizer ?? false,
					contactId: contactByEmail.get(email) ?? null,
				},
			});
		}
	}

	/**
	 * The timeline projection: one `Activity` per event, kept current.
	 *
	 * `occurredAt` is the meeting's start even when that is in the future, so an
	 * upcoming meeting sorts where a rep expects to find it rather than at the
	 * moment the sync happened to run.
	 */
	private async project(
		calendarEventId: string,
		userId: string,
		summary: {
			title: string;
			startsAt: Date;
			companyId: string | null;
			contactId: string | null;
			location: string | null;
		},
	): Promise<void> {
		const body = summary.location ? `Location: ${summary.location}` : null;

		const activity = await this.db.activity.upsert({
			where: { calendarEventId },
			create: {
				type: ActivityType.MEETING,
				subject: summary.title,
				body,
				occurredAt: summary.startsAt,
				companyId: summary.companyId,
				contactId: summary.contactId,
				createdById: userId,
				calendarEventId,
				meta: { synced: true, source: "calendar" },
			},
			update: {
				subject: summary.title,
				body,
				occurredAt: summary.startsAt,
				companyId: summary.companyId,
				contactId: summary.contactId,
			},
			select: { createdAt: true },
		});

		await this.stamp.touch(
			{ companyId: summary.companyId, contactId: summary.contactId },
			activity.createdAt,
		);
	}

	private participantsOf(event: GoogleEvent): Participant[] {
		const people: Participant[] = [];

		for (const attendee of event.attendees ?? []) {
			if (!attendee.email || attendee.resource) continue;
			people.push({
				email: attendee.email.toLowerCase(),
				name: attendee.displayName ?? null,
			});
		}

		// A one-to-one booked through a scheduling link often has the customer as
		// organiser and nobody in `attendees`.
		if (event.organizer?.email) {
			people.push({
				email: event.organizer.email.toLowerCase(),
				name: event.organizer.displayName ?? null,
			});
		}

		return people;
	}

	private horizon(): Date {
		const to = new Date();
		to.setDate(to.getDate() + HORIZON_DAYS);
		return to;
	}
}
