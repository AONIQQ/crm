import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { db } from "@crm/db";
import {
	bumpCounter,
	drainCounters,
	INSTALL_ID,
	reachMilestone,
	readInstall,
	syncVersion,
} from "../src/install";

const PACKAGE = join(import.meta.dir, "..");

const PRINT_UUID = [
	'import { db } from "@crm/db";',
	'import { readInstall } from "./src/install";',
	"const install = await readInstall();",
	'process.stdout.write(install?.uuid ?? "none");',
	"await db.$disconnect();",
	"process.exit(0);",
].join(" ");

const SPAWN_TIMEOUT_MS = 20_000;

async function uuidFromNewProcess(): Promise<string> {
	const process = Bun.spawn(["bun", "-e", PRINT_UUID], {
		cwd: PACKAGE,
		stdout: "pipe",
		stderr: "pipe",
	});

	const [output] = await Promise.all([
		new Response(process.stdout).text(),
		process.exited,
	]);

	return output.trim();
}

describe("the install row", () => {
	it("is a single row the migration already wrote", async () => {
		const rows = await db.install.findMany({ select: { id: true } });

		expect(rows).toEqual([{ id: INSTALL_ID }]);
	});

	it(
		"hands back the same UUID to two separate processes",
		async () => {
			const [first, second] = await Promise.all([
				uuidFromNewProcess(),
				uuidFromNewProcess(),
			]);

			expect(first).not.toBe("none");
			expect(first).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
			);
			expect(second).toBe(first);
			expect((await readInstall())?.uuid).toBe(first);
		},
		SPAWN_TIMEOUT_MS,
	);

	it("keeps the UUID when a boot writes a new version", async () => {
		const before = await readInstall();

		const updated = await syncVersion("9.9.9-test");
		expect(updated?.version).toBe("9.9.9-test");
		expect(updated?.uuid).toBe(before?.uuid as string);

		await syncVersion(before?.version ?? "unknown");
	});
});

describe("milestones", () => {
	const step = "first_fact_applied" as const;

	it("reports the first arrival and nothing after it", async () => {
		await db.telemetryMilestone.deleteMany({ where: { step } });

		expect(await reachMilestone(step)).toBe(true);
		expect(await reachMilestone(step)).toBe(false);
		expect(await reachMilestone(step)).toBe(false);

		await db.telemetryMilestone.deleteMany({ where: { step } });
	});
});

describe("counters", () => {
	const name = "budget_exhausted";

	it("adds up and then drains to nothing", async () => {
		await db.telemetryCounter.deleteMany({ where: { name } });

		await bumpCounter(name);
		await bumpCounter(name);
		await bumpCounter(name, 3);

		const drained = await drainCounters();
		expect(drained[name]).toBe(5);

		expect(await drainCounters()).toEqual({});
	});
});
