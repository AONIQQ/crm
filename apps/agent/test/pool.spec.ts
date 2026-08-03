import { describe, expect, it } from "bun:test";
import { runLimited } from "../agent/lib/pool";

describe("runLimited", () => {
	it("runs every item", async () => {
		const seen: number[] = [];

		await runLimited(3, [1, 2, 3, 4, 5, 6, 7], async (n) => {
			seen.push(n);
		});

		expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
	});

	it("never exceeds the width it was given", async () => {
		let running = 0;
		let peak = 0;

		await runLimited(
			3,
			Array.from({ length: 20 }, (_, i) => i),
			async () => {
				running += 1;
				peak = Math.max(peak, running);
				await new Promise((resolve) => setTimeout(resolve, 5));
				running -= 1;
			},
		);

		expect(peak).toBe(3);
	});

	it("does nothing with nothing", async () => {
		let calls = 0;

		await runLimited(4, [], async () => {
			calls += 1;
		});

		expect(calls).toBe(0);
	});

	it("does not spawn more workers than items", async () => {
		let peak = 0;
		let running = 0;

		await runLimited(10, [1, 2], async () => {
			running += 1;
			peak = Math.max(peak, running);
			await new Promise((resolve) => setTimeout(resolve, 5));
			running -= 1;
		});

		expect(peak).toBeLessThanOrEqual(2);
	});
});
