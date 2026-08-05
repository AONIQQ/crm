import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { captureNow, POSTHOG_HOST, resetTelemetryClient } from "../src/client";
import { forgetInstall, readInstall } from "../src/install";

const real = {
	fetch: globalThis.fetch,
	nodeEnv: process.env.NODE_ENV,
	disabled: process.env.CRM_TELEMETRY_DISABLED,
	doNotTrack: process.env.DO_NOT_TRACK,
};

let calls: { url: string; body: unknown }[] = [];

function stubFetch(): void {
	calls = [];

	globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
		calls.push({ url: String(input), body: await decode(init?.body) });

		return new Response(JSON.stringify({ status: 1 }), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}) as typeof fetch;
}

async function decode(body: unknown): Promise<unknown> {
	if (body === undefined || body === null) return null;
	if (typeof body === "string") return JSON.parse(body);

	const bytes =
		body instanceof Blob
			? new Uint8Array(await body.arrayBuffer())
			: new Uint8Array(body as ArrayBufferLike);

	const text = new TextDecoder().decode(Bun.gunzipSync(bytes));
	return JSON.parse(text);
}

beforeEach(() => {
	stubFetch();
	resetTelemetryClient();
	forgetInstall();

	process.env.NODE_ENV = "development";
	delete process.env.CRM_TELEMETRY_DISABLED;
	delete process.env.DO_NOT_TRACK;
});

afterEach(() => {
	globalThis.fetch = real.fetch;
	resetTelemetryClient();
	forgetInstall();

	restore("NODE_ENV", real.nodeEnv);
	restore("CRM_TELEMETRY_DISABLED", real.disabled);
	restore("DO_NOT_TRACK", real.doNotTrack);
});

function restore(name: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name];
		return;
	}

	process.env[name] = value;
}

describe("capture", () => {
	it("sends one event with the install UUID as the only identity", async () => {
		const install = await readInstall();
		expect(install).not.toBeNull();

		await captureNow("install_daily", { crm_version: "1.0.0" });

		expect(calls.length).toBe(1);
		expect(calls[0]?.url.startsWith(POSTHOG_HOST)).toBe(true);

		const event = eventOf(calls[0]?.body);

		expect(event.distinct_id).toBe(install?.uuid);
		expect(event.event).toBe("install_daily");
		expect(JSON.stringify(event)).not.toContain("identify");
	});

	it("drops a property that is not on the allowlist", async () => {
		await captureNow("install_daily", {
			crm_version: "1.0.0",
			contact_email: "ada@example.test",
			company_name: "Acme",
		} as never);

		const { properties } = eventOf(calls[0]?.body);

		expect(properties.crm_version).toBe("1.0.0");
		expect(properties).not.toHaveProperty("contact_email");
		expect(properties).not.toHaveProperty("company_name");
		expect(JSON.stringify(calls)).not.toContain("ada@example.test");
	});

	it("sends a null IP and no geoip on every event", async () => {
		await captureNow("install_daily", { crm_version: "1.0.0" });

		const { properties } = eventOf(calls[0]?.body);

		expect(properties.$ip).toBeNull();
		expect(properties.$geoip_disable ?? true).toBeTruthy();
	});

	it("makes no network call at all when CRM_TELEMETRY_DISABLED is set", async () => {
		process.env.CRM_TELEMETRY_DISABLED = "1";
		resetTelemetryClient();

		await captureNow("install_daily", { crm_version: "1.0.0" });

		expect(calls.length).toBe(0);
	});

	it("makes no network call at all when DO_NOT_TRACK is set", async () => {
		process.env.DO_NOT_TRACK = "1";
		resetTelemetryClient();

		await captureNow("install_daily", { crm_version: "1.0.0" });

		expect(calls.length).toBe(0);
	});

	it("makes no network call at all from a test run", async () => {
		process.env.NODE_ENV = "test";
		resetTelemetryClient();

		await captureNow("install_daily", { crm_version: "1.0.0" });

		expect(calls.length).toBe(0);
	});

	it("stays silent when the host refuses the send", async () => {
		globalThis.fetch = (async () => {
			throw new Error("network is down");
		}) as typeof fetch;

		expect(
			captureNow("install_daily", { crm_version: "1.0.0" }),
		).resolves.toBeUndefined();
	});
});

type Captured = {
	event: string;
	distinct_id: string;
	properties: Record<string, unknown>;
};

function eventOf(body: unknown): Captured {
	const batch = (body as { batch?: Captured[] })?.batch;
	const event = batch?.[0] ?? (body as Captured);

	return {
		event: event?.event,
		distinct_id: event?.distinct_id,
		properties: event?.properties ?? {},
	};
}
