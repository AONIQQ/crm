const TIMEOUT_MS = 5_000;
const MAX_HTML_BYTES = 512_000;

const ICON_REL = /^(shortcut )?icon$|^apple-touch-icon(-precomposed)?$/i;

function iconsFromHtml(html: string, base: URL): string[] {
	const found: { href: string; size: number }[] = [];

	for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
		const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.trim();
		if (!rel || !ICON_REL.test(rel)) continue;

		const href = /\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]?.trim();
		if (!href) continue;

		// "32x32" → 32. Unsized icons sort last rather than first: a declared
		// size is usually a real raster, and an undeclared one is often a 16px
		// .ico that looks like mud beside the artwork in the next row.
		const sizes = /\bsizes\s*=\s*["']?(\d+)/i.exec(tag)?.[1];

		try {
			found.push({
				href: new URL(href, base).toString(),
				size: Number(sizes ?? 0),
			});
		} catch {
			// A malformed href is one skipped icon, not a failed resolve.
		}
	}

	return found.sort((a, b) => b.size - a.size).map((icon) => icon.href);
}

async function request(url: string, method: "GET" | "HEAD" = "GET") {
	try {
		return await fetch(url, {
			method,
			signal: AbortSignal.timeout(TIMEOUT_MS),
			redirect: "follow",
			// Some origins serve a different page, or none, to an unknown agent.
			headers: { "user-agent": "Mozilla/5.0 (compatible; CRM/1.0)" },
		});
	} catch {
		return null;
	}
}

/** The page's HTML and the URL it ended up at, after redirects. */
async function readPage(url: URL): Promise<{ body: string; url: URL } | null> {
	const response = await request(url.toString());
	if (!response?.ok) return null;

	if (!(response.headers.get("content-type") ?? "").includes("html")) {
		return null;
	}

	const body = (await response.text()).slice(0, MAX_HTML_BYTES);
	return { body, url: new URL(response.url || url.toString()) };
}

/**
 * Whether a URL actually serves an image.
 *
 * Checked because a great many sites answer `/favicon.ico` with a 200 and an
 * HTML error page, and storing that URL puts a broken image in every table row
 * — the one outcome worse than the placeholder it replaced.
 */
async function servesImage(url: string): Promise<boolean> {
	const response = await request(url, "HEAD");
	if (!response?.ok) return false;

	return (response.headers.get("content-type") ?? "").startsWith("image/");
}

/**
 * The best icon a domain advertises, or `null`.
 *
 * Never throws and never guesses: `null` is a real answer and the safe one,
 * because a company with no icon is the state we were already in.
 */
export async function resolveFavicon(
	domain: string | null | undefined,
): Promise<string | null> {
	if (!domain) return null;

	try {
		const base = new URL(`https://${domain}`);
		const page = await readPage(base);

		const candidates = page ? iconsFromHtml(page.body, page.url) : [];
		// Every site is entitled to this path whether it advertises it or not,
		// so it is the last candidate rather than a separate branch.
		candidates.push(new URL("/favicon.ico", page?.url ?? base).toString());

		for (const candidate of candidates) {
			if (await servesImage(candidate)) return candidate;
		}
	} catch {
		// A domain that does not parse is a null, like one that does not answer.
	}

	return null;
}
