import { put } from "@vercel/blob";

/** Bigger than any avatar, small enough that a redirect to something huge stops here. */
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * Mirrors a profile picture into Vercel Blob.
 *
 * LinkedIn's CDN URLs are signed and expire — the ones we fetched carried
 * `e=1787184000`, roughly three weeks out. Storing that URL would give every
 * contact an avatar that works today and is a broken image next month, which is
 * worse than no avatar because nobody would connect the two.
 *
 * So the bytes are copied once and the record points at our own copy.
 *
 * Moved here from the API with the rest of enrichment: whoever writes the URL
 * onto the record is who should own fetching the bytes, and that is now the
 * agent. Plain functions rather than a Nest provider, because there is no
 * container on this side.
 */
export function avatarsEnabled(): boolean {
	return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/**
 * Fetches a remote image and stores it. Returns our URL, or null.
 *
 * Never throws: an avatar is decoration, and a contact whose photo could not be
 * fetched is still a contact worth having.
 */
export async function mirrorAvatar(
	sourceUrl: string,
	contactId: string,
): Promise<string | null> {
	if (!avatarsEnabled()) return null;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

	try {
		const response = await fetch(sourceUrl, {
			signal: controller.signal,
			// LinkedIn's CDN rejects requests carrying our origin.
			referrerPolicy: "no-referrer",
		});

		if (!response.ok) return null;

		const type = response.headers.get("content-type")?.split(";")[0]?.trim();
		if (!type || !ALLOWED.has(type)) return null;

		const buffer = await response.arrayBuffer();
		if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) return null;

		// Keyed by contact, so re-running replaces the photo rather than
		// littering the store with orphans.
		const extension = type.split("/")[1] ?? "jpg";
		const blob = await put(
			`contacts/${contactId}.${extension}`,
			Buffer.from(buffer),
			{
				access: "public",
				contentType: type,
				addRandomSuffix: false,
				allowOverwrite: true,
			},
		);

		return blob.url;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}
