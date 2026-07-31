import { Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";

type Job = {
	/** Dedupe key — the domain, so the same company queued twice runs once. */
	key: string;
	run: () => Promise<void>;
};

const CONCURRENCY = 2;

/**
 * A small in-process queue for enrichment work.
 *
 * Deliberately not a job server. Enrichment is a handful of calls per company
 * create, the work is idempotent, and losing a queued job on deploy costs
 * nothing — the company stays `PENDING` and the next re-enrich picks it up. A
 * Redis-backed queue would be more machinery than the problem has.
 *
 * What it does buy us: at most two concurrent Context.dev calls, one retry with
 * a backoff, and per-domain dedupe so a rep hammering "Re-enrich" does not
 * spend ten credits doing the same lookup ten times.
 */
@Injectable()
export class EnrichmentQueue implements OnApplicationShutdown {
	private readonly logger = new Logger(EnrichmentQueue.name);
	private readonly pending: Job[] = [];
	private readonly inFlight = new Set<string>();
	private running = 0;
	private shuttingDown = false;

	/**
	 * How long to wait before the single retry.
	 *
	 * A getter rather than a constant so the tests can subclass it down to a few
	 * milliseconds — Nest constructs this provider with no arguments, so a
	 * constructor parameter would need a DI token for no benefit.
	 */
	protected get retryDelayMs(): number {
		return 5_000;
	}

	/** Resolves when the queue is empty — the hook tests wait on this. */
	private idle: (() => void)[] = [];

	/**
	 * Queues work, unless the same key is already queued or running.
	 *
	 * Returns whether it was accepted, so a caller can tell "started" from
	 * "already in progress".
	 */
	enqueue(key: string, run: () => Promise<void>): boolean {
		if (this.shuttingDown) return false;
		if (this.inFlight.has(key)) return false;
		if (this.pending.some((job) => job.key === key)) return false;

		this.pending.push({ key, run });
		this.pump();
		return true;
	}

	/** Waits for everything queued so far to finish. For tests and scripts. */
	async drain(): Promise<void> {
		if (this.running === 0 && this.pending.length === 0) return;
		await new Promise<void>((resolve) => this.idle.push(resolve));
	}

	onApplicationShutdown(): void {
		this.shuttingDown = true;
		// Queued-but-not-started work is dropped rather than raced against the
		// closing database connection. Those companies stay PENDING, which is
		// exactly the state a retry looks for.
		const dropped = this.pending.length;
		this.pending.length = 0;
		if (dropped > 0) {
			this.logger.log({ message: "Dropped queued enrichment jobs", dropped });
		}
	}

	private pump(): void {
		while (this.running < CONCURRENCY && this.pending.length > 0) {
			const job = this.pending.shift();
			if (!job) break;
			void this.execute(job);
		}
	}

	private async execute(job: Job): Promise<void> {
		this.running += 1;
		this.inFlight.add(job.key);

		try {
			await job.run();
		} catch (error) {
			// One retry, after a pause. Anything that fails twice is recorded on the
			// company as `FAILED` by the service itself; this is the safety net for
			// an exception the service did not expect.
			this.logger.warn({
				message: "Enrichment job threw — retrying once",
				key: job.key,
				reason: error instanceof Error ? error.message : String(error),
			});

			await sleep(this.retryDelayMs);

			try {
				await job.run();
			} catch (retryError) {
				this.logger.error(
					{ message: "Enrichment job failed twice", key: job.key },
					retryError instanceof Error ? retryError.stack : String(retryError),
				);
			}
		} finally {
			this.running -= 1;
			this.inFlight.delete(job.key);
			this.pump();

			if (this.running === 0 && this.pending.length === 0) {
				const waiters = this.idle;
				this.idle = [];
				for (const resolve of waiters) resolve();
			}
		}
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
