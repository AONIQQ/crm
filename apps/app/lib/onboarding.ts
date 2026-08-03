import type { NextRequest, NextResponse } from "next/server";
import { API_URL } from "@/lib/env";

export const ONBOARDING_PATH = "/onboarding";

export const RESEARCH_PATH = "/onboarding/research";

/**
 * Skip is a link the proxy answers rather than a page, so the gate that would
 * otherwise redirect it back to the form is the same thing that lets it go.
 */
export const RESEARCH_SKIP_PATH = "/onboarding/research/skip";

export const ONBOARDING_COOKIE = "crm.onboarded";

export const RESEARCH_COOKIE = "crm.research";

/**
 * Two cookies because they record two different facts: one caches *a key is
 * saved*, the other *this browser was asked and said not now*. One writer each,
 * and neither can be mistaken for the other.
 */
export const RESEARCH_SKIPPED_COOKIE = "crm.research.skipped";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const GATE_TIMEOUT_MS = 2_000;

export type Gate = "settled" | "required" | "unknown";

async function read<T>(
	request: NextRequest,
	procedure: string,
): Promise<T | null> {
	const cookie = request.headers.get("cookie");

	if (!cookie) return null;

	try {
		const response = await fetch(`${API_URL}/api/trpc/${procedure}`, {
			headers: { cookie },
			signal: AbortSignal.timeout(GATE_TIMEOUT_MS),
		});

		if (!response.ok) return null;

		const body = (await response.json()) as { result?: { data?: T } };

		return body.result?.data ?? null;
	} catch {
		return null;
	}
}

export async function readOnboardingGate(request: NextRequest): Promise<Gate> {
	const workspace = await read<{ onboarded?: boolean; canRename?: boolean }>(
		request,
		"workspace.get",
	);

	if (typeof workspace?.onboarded !== "boolean") return "unknown";

	return workspace.onboarded || !workspace.canRename ? "settled" : "required";
}

export async function readResearchGate(request: NextRequest): Promise<Gate> {
	const key = await read<{ configured?: boolean }>(
		request,
		"settings.researchKey",
	);

	if (typeof key?.configured !== "boolean") return "unknown";

	return key.configured ? "settled" : "required";
}

export function settle(
	request: NextRequest,
	response: NextResponse,
	name: string,
): void {
	response.cookies.set(name, "1", {
		httpOnly: true,
		sameSite: "lax",
		secure: request.nextUrl.protocol === "https:",
		path: "/",
		maxAge: COOKIE_MAX_AGE,
	});
}
