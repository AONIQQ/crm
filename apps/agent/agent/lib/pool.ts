export function collapsing<A extends unknown[]>(
	run: (...args: A) => Promise<void>,
): (...args: A) => Promise<void> {
	let active: Promise<void> | null = null;
	let trailing: A | null = null;

	const invoke = async (...args: A): Promise<void> => {
		if (active) {
			trailing = args;
			return active;
		}

		active = run(...args);

		try {
			await active;
		} finally {
			active = null;
		}

		const next = trailing;
		trailing = null;
		if (next) await invoke(...next);
	};

	return invoke;
}

export async function runLimited<T>(
	concurrency: number,
	items: readonly T[],
	run: (item: T) => Promise<void>,
): Promise<void> {
	const width = Math.max(1, Math.min(concurrency, items.length));
	let next = 0;

	const workers = Array.from({ length: width }, async () => {
		while (true) {
			const index = next++;
			if (index >= items.length) return;

			const item = items[index];
			if (item === undefined) return;

			await run(item);
		}
	});

	await Promise.all(workers);
}
