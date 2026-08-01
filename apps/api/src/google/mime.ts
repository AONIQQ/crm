/**
 * Turning a Gmail payload into something readable.
 *
 * All pure: the awkward cases here (nested multiparts, quoted-printable, a
 * forty-message quote trail) are exactly what wants table-driven tests without
 * a network or a database.
 */

export type GmailHeader = { name?: string; value?: string };

export type GmailPart = {
	mimeType?: string;
	filename?: string;
	headers?: GmailHeader[];
	body?: { data?: string; size?: number; attachmentId?: string };
	parts?: GmailPart[];
};

/** Case-insensitive header lookup — Gmail is inconsistent about casing. */
export function header(
	headers: readonly GmailHeader[] | undefined,
	name: string,
): string | null {
	const wanted = name.toLowerCase();
	const found = headers?.find((entry) => entry.name?.toLowerCase() === wanted);
	return found?.value?.trim() ?? null;
}

/** Gmail encodes every body as base64url, which `atob` will not accept. */
export function decodeBase64Url(data: string): string {
	const normalised = data.replace(/-/g, "+").replace(/_/g, "/");
	const padded = normalised.padEnd(
		normalised.length + ((4 - (normalised.length % 4)) % 4),
		"=",
	);

	try {
		return Buffer.from(padded, "base64").toString("utf8");
	} catch {
		return "";
	}
}

/**
 * The plain-text body.
 *
 * Prefers `text/plain`; falls back to stripping tags out of `text/html`,
 * because plenty of senders ship HTML only and "(no body)" on the timeline is
 * useless. Attachments are skipped — v1 stores no bytes.
 */
export function plainTextBody(payload: GmailPart | undefined): string {
	if (!payload) return "";

	const plain = findPart(payload, "text/plain");
	if (plain?.body?.data) return decodeBase64Url(plain.body.data);

	const html = findPart(payload, "text/html");
	if (html?.body?.data) return stripHtml(decodeBase64Url(html.body.data));

	if (payload.body?.data && !payload.filename) {
		return decodeBase64Url(payload.body.data);
	}

	return "";
}

/** Depth-first search for a mime type, skipping attachment parts. */
function findPart(part: GmailPart, mimeType: string): GmailPart | null {
	if (part.mimeType === mimeType && !part.filename && part.body?.data) {
		return part;
	}

	for (const child of part.parts ?? []) {
		const found = findPart(child, mimeType);
		if (found) return found;
	}

	return null;
}

export function stripHtml(html: string): string {
	return html
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * Where the quoted history starts.
 *
 * A reply carries the entire conversation beneath it, so storing the raw body
 * would mean the same text N times over a thread and a timeline entry that is
 * mostly `>`. Each pattern is a line that begins the quote; everything from the
 * first match is dropped.
 */
const QUOTE_MARKERS: RegExp[] = [
	// "On Tue, 5 Aug 2025 at 14:02, Jane <jane@acme.com> wrote:"
	/^\s*On .+ wrote:\s*$/m,
	// Outlook and most corporate clients.
	/^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
	/^\s*_{5,}\s*$/m,
	/^\s*From:\s.+$/m,
	// Apple Mail.
	/^\s*Begin forwarded message:\s*$/im,
	// Gmail's own divider when the client collapses history.
	/^\s*-{3,}\s*Forwarded message\s*-{3,}\s*$/im,
];

export function stripQuotedHistory(body: string): string {
	let cut = body.length;

	for (const marker of QUOTE_MARKERS) {
		const match = marker.exec(body);
		if (match && match.index < cut) cut = match.index;
	}

	let trimmed = body.slice(0, cut);

	// Whatever survives, drop trailing lines that are pure quote — some clients
	// interleave rather than appending.
	const lines = trimmed.split("\n");
	while (lines.length > 0 && /^\s*>/.test(lines[lines.length - 1] ?? "")) {
		lines.pop();
	}
	trimmed = lines.join("\n");

	return trimmed.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * The id of the conversation root, from the reply chain.
 *
 * `References` lists the ancestry oldest-first, so its first entry is the root.
 * Falling back to `In-Reply-To` handles clients that omit `References`, and
 * finally a message that starts a thread is its own root.
 *
 * This is what makes a thread global. Gmail's `threadId` is scoped to one
 * mailbox, so two reps on the same conversation report different ids for it —
 * keying on those would put one conversation on a company's timeline twice.
 */
export function rootMessageId(
	headers: readonly GmailHeader[] | undefined,
): string | null {
	const references = header(headers, "references");
	if (references) {
		const first = references
			.split(/\s+/)
			.find((entry) => entry.startsWith("<"));
		if (first) return normaliseMessageId(first);
	}

	const inReplyTo = header(headers, "in-reply-to");
	if (inReplyTo) return normaliseMessageId(inReplyTo);

	const own = header(headers, "message-id");
	return own ? normaliseMessageId(own) : null;
}

/** Strips the angle brackets so `<a@b>` and `a@b` are the same identity. */
export function normaliseMessageId(value: string): string {
	return value.trim().replace(/^</, "").replace(/>$/, "").toLowerCase();
}

/** A short preview for the timeline row. Never the whole body. */
export function snippetOf(body: string, limit = 200): string | null {
	const flat = body.replace(/\s+/g, " ").trim();
	if (!flat) return null;
	return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}
