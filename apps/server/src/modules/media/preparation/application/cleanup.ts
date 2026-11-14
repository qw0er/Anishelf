import type { Logger } from "pino";

/** Owns the periodic sweep independently of preparation jobs. */
export class PreparationCleanup {
	private timer: ReturnType<typeof setTimeout> | undefined;
	private active: Promise<void> | undefined;
	private closed = false;

	constructor(
		private readonly intervalMs: number,
		private readonly sweep: () => Promise<unknown>,
		private readonly logger: Logger,
	) {}

	start(): void {
		if (this.closed || this.timer || this.active) return;
		this.timer = setTimeout(() => {
			this.timer = undefined;
			this.active = Promise.resolve()
				.then(() => this.sweep())
				.catch((error) => {
					this.logger.warn(
						{
							event: "preparation.cleanup_failed",
							errorName: error instanceof Error ? error.name : "unknown",
						},
						"Prepared copy cleanup failed; another sweep will be scheduled.",
					);
				})
				.then(() => {
					this.active = undefined;
					this.start();
				});
		}, this.intervalMs);
		this.timer.unref();
	}

	async close(): Promise<void> {
		this.closed = true;
		clearTimeout(this.timer);
		await this.active;
	}
}
