import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Optimistic auth routing.
 *
 * This only looks at whether a session cookie is *present* — no database
 * round-trip, because proxy runs on prefetches too. The real check lives in
 * `requireSession()`, which every protected page calls.
 *
 * Deliberately one-directional. Turning anonymous traffic away from protected
 * routes is safe to guess at: the worst case is a redirect the authoritative
 * check would have made anyway. Turning cookie-bearing traffic away from
 * `/sign-in` is not, because a cookie can be present and still not resolve to a
 * session — expired, database reset, secret rotated, database down. Then this
 * bounces the browser to `/`, `requireSession()` bounces it straight back to
 * `/sign-in`, and neither side ever wins. Sending genuinely signed-in users off
 * `/sign-in` belongs on the sign-in page, where the session can be verified.
 */
export function proxy(request: NextRequest) {
	const isSignedIn = getSessionCookie(request) !== null;
	const isSignInPage = request.nextUrl.pathname === "/sign-in";

	if (!isSignedIn && !isSignInPage) {
		return NextResponse.redirect(new URL("/sign-in", request.nextUrl));
	}

	return NextResponse.next();
}

export const config = {
	// Static assets are excluded by extension rather than by name: the icon set
	// in `public/` (favicon.svg, favicon-96x96.png, apple-touch-icon.png,
	// site.webmanifest, web-app-manifest-*.png) is fetched by the browser with no
	// regard for auth, and redirecting those to /sign-in serves HTML where an
	// image or a manifest was expected.
	//
	// `/api/*` is excluded for the same reason: it is the passthrough to the
	// NestJS API, which does its own auth and answers with a 401. A caller
	// expecting JSON should get that, not a 307 to a sign-in page.
	matcher: [
		"/((?!api|_next/static|_next/image|.*\\.(?:ico|png|svg|jpg|jpeg|gif|webp|webmanifest)$).*)",
	],
};
