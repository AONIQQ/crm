import {
	type Properties,
	permittedErrorClass,
	permittedModelId,
	permittedRoute,
	permittedSyncSource,
	permittedTaskKind,
	permittedTool,
} from "./allowlist";
import { capture, captureNow } from "./client";
import { telemetryDisabled } from "./disabled";
import { type Milestone, reachMilestone } from "./install";

export const INSTALL_DAILY = "install_daily";

export const AGENT_ERROR = "agent_error";

export const SYNC_ERROR = "sync_error";

export const API_ERROR = "api_error";

export const MODEL_ERROR = "model_error";

export async function installDaily(properties: Properties): Promise<boolean> {
	return captureNow(INSTALL_DAILY, properties);
}

export async function milestone(step: Milestone, at?: Date): Promise<boolean> {
	if (telemetryDisabled()) return false;

	const sent = await captureNow(step, {}, at);
	if (!sent) return false;

	await reachMilestone(step);

	return true;
}

export function agentError(input: {
	error: unknown;
	tool?: string | null;
	taskKind?: string | null;
	source?: "tool" | "session" | "turn";
}): void {
	capture(AGENT_ERROR, {
		error_class: permittedErrorClass(input.error),
		error_source: input.source ?? "tool",
		tool: permittedTool(input.tool),
		task_kind: permittedTaskKind(input.taskKind),
	});
}

export function syncError(input: { error: unknown; source: string }): void {
	capture(SYNC_ERROR, {
		error_class: permittedErrorClass(input.error),
		error_source: "google_sync",
		sync_source: permittedSyncSource(input.source),
	});
}

export function apiError(input: {
	error: unknown;
	route: string | null;
	status: number;
}): void {
	capture(API_ERROR, {
		error_class: permittedErrorClass(input.error),
		error_source: "api",
		route: permittedRoute(input.route),
		status_code: input.status,
	});
}

export function modelError(input: {
	error: unknown;
	modelId?: string | null;
}): void {
	capture(MODEL_ERROR, {
		error_class: permittedErrorClass(input.error),
		error_source: "model",
		model_id: permittedModelId(input.modelId),
	});
}
