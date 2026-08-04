import { AUTH_COOKIE_PREFIX } from "@crm/auth/cookies";
import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import {
	ONBOARDING_PATH,
	RESEARCH_PATH,
	readOnboardingGate,
	readResearchGate,
} from "@/lib/onboarding";

const SIGN_IN_PATH = "/sign-in";

const UNGATED = [SIGN_IN_PATH, "/grant-access", "/eve"];

export async function proxy(request: NextRequest) {
	const { pathname } = request.nextUrl;

	if (
		getSessionCookie(request, { cookiePrefix: AUTH_COOKIE_PREFIX }) === null
	) {
		return pathname === SIGN_IN_PATH
			? NextResponse.next()
			: NextResponse.redirect(new URL(SIGN_IN_PATH, request.nextUrl));
	}

	if (isUngated(pathname)) return NextResponse.next();

	// Both answers, every time, and concurrently — so the gate costs one round
	// trip rather than two, and neither answer can be stale.
	const [onboarding, research] = await Promise.all([
		readOnboardingGate(request),
		readResearchGate(request),
	]);

	if (onboarding === "required") return sendTo(ONBOARDING_PATH, request);
	if (research === "required") return sendTo(RESEARCH_PATH, request);

	const settled = onboarding === "settled" && research === "settled";

	return settled && isSetup(pathname)
		? NextResponse.redirect(new URL("/", request.nextUrl))
		: NextResponse.next();
}

function isUngated(pathname: string): boolean {
	return UNGATED.some(
		(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
	);
}

function isSetup(pathname: string): boolean {
	return pathname === ONBOARDING_PATH || pathname === RESEARCH_PATH;
}

function sendTo(path: string, request: NextRequest): NextResponse {
	return request.nextUrl.pathname === path
		? NextResponse.next()
		: NextResponse.redirect(new URL(path, request.nextUrl));
}

export const config = {
	matcher: [
		"/((?!api|_next/static|_next/image|.*\\.(?:ico|png|svg|jpg|jpeg|gif|webp|webmanifest)$).*)",
	],
};
