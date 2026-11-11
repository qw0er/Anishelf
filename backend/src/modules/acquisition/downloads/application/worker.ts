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
	private loopRunning = false;
	private wakeRequested = false;
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
						(item) => {
							if (item.acceptedTarget)
								this.context.options.ingestion.releaseTarget?.(
									item.acceptedTarget,
									item.id,
								);
						},
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
	private async run() {
		if (this.loopRunning || this.context.signal.aborted) return;
		this.loopRunning = true;
		this.wakeRequested = false;
		try {
			await this.tick();
		} finally {
			this.loopRunning = false;
		}
		if (this.context.signal.aborted) return;
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(
			() => {
				void this.run();
			},
			this.wakeRequested
				? 0
				: this.context.options.store.hasActive()
					? policy.activeIntervalMs
					: policy.idleIntervalMs,
		);
		this.timer.unref();
	}
	wake() {
		if (!this.started || this.context.signal.aborted) return;
		this.wakeRequested = true;
		if (this.loopRunning) return;
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			void this.run();
		}, 0);
		this.timer.unref();
	}
	start() {
		if (this.started || this.context.signal.aborted) return;
		this.started = true;
		void this.run();
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
