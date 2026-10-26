import { downloadDefaults as policy } from "../defaults.js";
import type { DownloadApplicationContext } from "./context.js";
import type { DownloadDestinationSettings } from "./destination.js";
import type { DownloadReconciliation } from "./reconciliation.js";
import type { DownloadPlanning } from "./reservations.js";

/** Owns serial ticks, bounded batches and shutdown; stages own business decisions. */
export class DownloadWorker {
	private timer: ReturnType<typeof setTimeout> | undefined;
	private running: Promise<void> | undefined;
	private started = false;
	constructor(
		private readonly context: DownloadApplicationContext,
		private readonly reservations: DownloadPlanning,
		private readonly reconciliation: DownloadReconciliation,
		private readonly destination: DownloadDestinationSettings,
	) {}
	tick(): Promise<void> {
		if (this.running || this.context.signal.aborted)
			return this.running ?? Promise.resolve();
		// Reserve the running slot before any collaborator can yield or request another tick.
		const task = Promise.resolve()
			.then(async () => {
				await this.destination.initializeBundled();
				await this.reservations.run();
				let afterId = "";
				while (!this.context.signal.aborted) {
					const batch = this.context.options.store.workBatch(
						afterId,
						policy.maximumConcurrent,
						this.context.now(),
					);
					if (!batch.length) break;
					afterId = batch[batch.length - 1]?.id ?? afterId;
					await Promise.all(batch.map((item) => this.reconciliation.run(item)));
				}
				if (!this.context.signal.aborted)
					this.context.options.store.prune(
						this.context.now() - policy.historyMs,
					);
			})
			.catch(() => {
				if (!this.context.signal.aborted)
					this.context.options.logger.warn(
						{ event: "acquisition.worker_failed" },
						"Acquisition worker will retry.",
					);
			});
		this.running = task;
		void task.finally(() => {
			this.running = undefined;
		});
		return task;
	}
	start() {
		if (this.started || this.context.signal.aborted) return;
		this.started = true;
		const run = async () => {
			await this.tick();
			if (this.context.signal.aborted) return;
			this.timer = setTimeout(
				() => {
					void run();
				},
				this.context.options.store.hasActive()
					? policy.activeIntervalMs
					: policy.idleIntervalMs,
			);
			this.timer.unref();
		};
		void run();
	}
	async close() {
		this.context.shutdown.abort();
		if (this.timer) clearTimeout(this.timer);
		await this.context.options.transport.close();
		await Promise.allSettled([
			...this.context.pending,
			...(this.running ? [this.running] : []),
		]);
	}
}
