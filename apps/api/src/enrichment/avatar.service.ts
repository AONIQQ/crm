import { Injectable, Logger } from "@nestjs/common";
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
 */
@Injectable()
export class AvatarService {
	private readonly logger = new Logger(AvatarService.name);

	get enabled(): boolean {
		return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
	}

	/**
	 * Fetches a remote image and stores it. Returns our URL, or null.
	 *
	 * Never throws: an avatar is decoration, and a contact whose photo could not
	 * be fetched is still a contact worth having.
	 */
	async mirror(sourceUrl: string, contactId: string): Promise<string | null> {
		if (!this.enabled) return null;

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
			if (!type || !ALLOWED.has(type)) {
				this.logger.debug({
					message: "Avatar skipped — not an image",
					contactId,
					type,
				});
				return null;
			}

			const buffer = await response.arrayBuffer();
			if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) return null;

			// Keyed by contact, so re-enriching replaces the photo rather than
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

			this.logger.log({
				message: "Avatar mirrored",
				contactId,
				bytes: buffer.byteLength,
			});

			return blob.url;
		} catch (error) {
			this.logger.debug({
				message: "Avatar mirror failed",
				contactId,
				reason: error instanceof Error ? error.message : String(error),
			});
			return null;
		} finally {
			clearTimeout(timer);
		}
	}
}
