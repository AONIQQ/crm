import { Injectable } from "@nestjs/common";
import { GoogleApiClient, type GoogleResult } from "./google-api.client";

const EVENTS_URL =
	"https://www.googleapis.com/calendar/v3/calendars/primary/events";

/** The slice of Google's event resource we actually read. */
export type GoogleEvent = {
	id?: string;
	iCalUID?: string;
	status?: string;
	summary?: string;
	description?: string;
	location?: string;
	hangoutLink?: string;
	htmlLink?: string;
	recurringEventId?: string;
	start?: GoogleEventTime;
	end?: GoogleEventTime;
	originalStartTime?: GoogleEventTime;
	organizer?: { email?: string; displayName?: string; self?: boolean };
	creator?: { email?: string; displayName?: string; self?: boolean };
	attendees?: {
		email?: string;
		displayName?: string;
		responseStatus?: string;
		organizer?: boolean;
		self?: boolean;
		resource?: boolean;
	}[];
	conferenceData?: {
		entryPoints?: { entryPointType?: string; uri?: string }[];
	};
};

export type GoogleEventTime = {
	/** Set on a timed event. */
	dateTime?: string;
	/** Set on an all-day event; a bare `YYYY-MM-DD`. */
	date?: string;
	timeZone?: string;
};

export type EventsPage = {
	items?: GoogleEvent[];
	nextPageToken?: string;
	nextSyncToken?: string;
};

export type EventsQuery = {
	/** Incremental. Mutually exclusive with the time window, per Google. */
	syncToken?: string;
	timeMin?: string;
	timeMax?: string;
	pageToken?: string;
	maxResults?: number;
};

@Injectable()
export class CalendarClient {
	constructor(private readonly api: GoogleApiClient) {}

	/**
	 * One page of events.
	 *
	 * `singleEvents: true` expands recurring series into instances, which is what
	 * makes `(iCalUID, originalStartTime)` a usable key — an unexpanded series
	 * would be one row for "every Tuesday forever" and could not sit on a
	 * timeline. `showDeleted: true` is how cancellations arrive at all.
	 */
	async listEvents(
		accessToken: string,
		query: EventsQuery,
	): Promise<GoogleResult<EventsPage>> {
		// Google rejects a request carrying both a syncToken and a time window.
		const window = query.syncToken
			? {}
			: { timeMin: query.timeMin, timeMax: query.timeMax };

		return this.api.get<EventsPage>(EVENTS_URL, accessToken, {
			singleEvents: true,
			showDeleted: true,
			maxResults: query.maxResults ?? 250,
			syncToken: query.syncToken,
			pageToken: query.pageToken,
			...window,
		});
	}
}

/** The best conference link on an event, if it has one. */
export function conferenceUrl(event: GoogleEvent): string | null {
	if (event.hangoutLink) return event.hangoutLink;

	const entry = event.conferenceData?.entryPoints?.find(
		(point) => point.entryPointType === "video" && point.uri,
	);

	return entry?.uri ?? null;
}

/** A Google event time as a Date, plus whether the event is all-day. */
export function eventTime(
	time: GoogleEventTime | undefined,
): { at: Date; isAllDay: boolean } | null {
	if (time?.dateTime) {
		const at = new Date(time.dateTime);
		return Number.isNaN(at.getTime()) ? null : { at, isAllDay: false };
	}

	if (time?.date) {
		// A bare date is midnight local to the calendar; parsing it as UTC keeps
		// the key stable regardless of where the server runs.
		const at = new Date(`${time.date}T00:00:00Z`);
		return Number.isNaN(at.getTime()) ? null : { at, isAllDay: true };
	}

	return null;
}
