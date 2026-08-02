import dns from "node:dns/promises";
import net from "node:net";

const TIMEOUT_MS = 5_000;
const MAX_HTML_BYTES = 512_000;

/**
 * A page can advertise as many `<link rel="icon">` tags as it likes, and each
 * one costs a HEAD request. Ten is more than any real site publishes and caps
 * a hostile one at eleven requests including the `/favicon.ico` fallback.
 */
const MAX_ICON_CANDIDATES = 10;

/** Enough for the usual apex-to-www or http-to-https hop, and no further. */
const MAX_REDIRECTS = 3;

/**
 * Addresses that must never be fetched.
 *
 * The domain on a company is attacker-supplied — anyone who can create a
 * company picks it — and this code runs inside the API, which can reach things
 * the internet cannot: cloud metadata on 169.254.169.254, Postgres on the
 * private network, anything bound to loopback. A `<link rel="icon">` pointing
 * at one of those turns "resolve a favicon" into a request forgery primitive,
 * so every hop is checked rather than only the domain we started from.
 */
function isBlockedAddress(ip: string): boolean {
	const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;

	if (net.isIPv4(v4)) {
		const [a = 0, b = 0] = v4.split(".").map(Number);
		return (
			a === 0 || // this network
			a === 10 || // private
			a === 127 || // loopback
			(a === 169 && b === 254) || // link-local, incl. cloud metadata
			(a === 172 && b >= 16 && b <= 31) || // private
			(a === 192 && b === 168) || // private
			(a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
			(a === 198 && (b === 18 || b === 19)) || // benchmarking
			a >= 224 // multicast and reserved
		);
	}

	const v6 = ip.toLowerCase();
	return (
		v6 === "::" ||
		v6 === "::1" || // loopback
		v6.startsWith("fc") ||
		v6.startsWith("fd") || // unique local
		v6.startsWith("fe8") ||
		v6.startsWith("fe9") ||
		v6.startsWith("fea") ||
		v6.startsWith("feb") // link-local
	);
}

/**
 * Whether every address a hostname resolves to is publicly routable.
 *
 * Checked before each request rather than once up front, because a redirect
 * can send us somewhere else entirely.
 *
 * This does not close the DNS-rebinding window: the name is resolved here and
 * again by `fetch`, and a hostile server can answer differently the second
 * time. Closing it properly means pinning the connection to the address we
 * validated, which needs a custom agent. This blocks the whole practical
 * attack — an icon link pointing straight at an internal host — and the
 * remaining hole needs an attacker who controls authoritative DNS.
 */
async function resolvesToPublicHost(hostname: string): Promise<boolean> {
	if (net.isIP(hostname)) return !isBlockedAddress(hostname);

	try {
		const addresses = await dns.lookup(hostname, { all: true });
		return (
			addresses.length > 0 &&
			addresses.every((address) => !isBlockedAddress(address.address))
		);
	} catch {
		return false;
	}
}

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

/**
 * A fetch that refuses to leave the public internet.
 *
 * Redirects are followed by hand — `redirect: "follow"` would chase a `Location`
 * into the private network without ever showing it to us, which is exactly the
 * hop that needs checking.
 */
async function request(
	url: string,
	method: "GET" | "HEAD" = "GET",
): Promise<{ response: Response; url: URL } | null> {
	let target: URL;
	try {
		target = new URL(url);
	} catch {
		return null;
	}

	for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
		// Anything that is not plain HTTP can address things a browser would not:
		// file://, and the gopher/dict tricks that turn a fetcher into a client
		// for whatever is listening on an internal port.
		if (target.protocol !== "https:" && target.protocol !== "http:")
			return null;
		if (!(await resolvesToPublicHost(target.hostname))) return null;

		let response: Response;
		try {
			response = await fetch(target, {
				method,
				signal: AbortSignal.timeout(TIMEOUT_MS),
				redirect: "manual",
				// Some origins serve a different page, or none, to an unknown agent.
				headers: { "user-agent": "Mozilla/5.0 (compatible; CRM/1.0)" },
			});
		} catch {
			return null;
		}

		const location = response.headers.get("location");
		if (response.status >= 300 && response.status < 400 && location) {
			await response.body?.cancel();
			try {
				target = new URL(location, target);
			} catch {
				return null;
			}
			continue;
		}

		return { response, url: target };
	}

	return null;
}

/**
 * The page's HTML and the URL it ended up at, after redirects.
 *
 * Read a chunk at a time and cancelled at the cap, rather than `await
 * response.text()` and then slicing: slicing throws the excess away only after
 * the whole body is already in memory, so a hostile origin streaming gigabytes
 * would exhaust the API before the limit was ever applied.
 */
async function readPage(url: URL): Promise<{ body: string; url: URL } | null> {
	const result = await request(url.toString());
	if (!result?.response.ok) return null;

	const { response } = result;
	if (!(response.headers.get("content-type") ?? "").includes("html")) {
		await response.body?.cancel();
		return null;
	}
	if (!response.body) return null;

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let body = "";
	let bytes = 0;

	try {
		while (bytes < MAX_HTML_BYTES) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			body += decoder.decode(value, { stream: true });
		}
	} catch {
		return null;
	} finally {
		await reader.cancel().catch(() => {});
	}

	return { body, url: result.url };
}

/**
 * Whether a URL actually serves an image.
 *
 * Checked because a great many sites answer `/favicon.ico` with a 200 and an
 * HTML error page, and storing that URL puts a broken image in every table row
 * — the one outcome worse than the placeholder it replaced.
 */
async function servesImage(url: string): Promise<boolean> {
	const result = await request(url, "HEAD");
	if (!result?.response.ok) return false;

	await result.response.body?.cancel();
	return (result.response.headers.get("content-type") ?? "").startsWith(
		"image/",
	);
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

		// Capped before the fallback is appended, so a page listing a thousand
		// icons cannot turn one company lookup into a thousand HEAD requests.
		const candidates = page
			? iconsFromHtml(page.body, page.url).slice(0, MAX_ICON_CANDIDATES)
			: [];
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
