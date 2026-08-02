import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
	const isSignedIn = getSessionCookie(request) !== null;
	const isSignInPage = request.nextUrl.pathname === "/sign-in";

	if (!isSignedIn && !isSignInPage) {
		return NextResponse.redirect(new URL("/sign-in", request.nextUrl));
	}

	return NextResponse.next();
}

export const config = {
	matcher: [
		"/((?!api|_next/static|_next/image|.*\\.(?:ico|png|svg|jpg|jpeg|gif|webp|webmanifest)$).*)",
	],
};
