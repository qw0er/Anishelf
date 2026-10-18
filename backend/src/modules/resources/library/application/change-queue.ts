import type { Logger } from "pino";
import type { DeepReadonly } from "../../../../shared/policy.js";
import type { LibraryPolicy } from "../policy.js";

/** A bounded per-directory work queue; it never owns native watchers or the publication gate. */
export class ChangeQueue {
	private pending = new Set<string>();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private active: Promise<void> | undefined;
	private closed = false;
	private recovery = false;
	private failureVersion = 0;
	private retryMs: number;
	constructor(
		private readonly options: {
			policy: DeepReadonly<LibraryPolicy>;
			logger: Logger;
			isBusy(): boolean;
			apply(paths: readonly string[]): Promise<boolean>;
			reconcile(): Promise<void>;
		},
	) {
		this.retryMs = options.policy.monitorRetryMs;
	}
	get degraded(): boolean {
		return this.recovery;
	}
	enqueue(path: string): void {
		if (this.closed) return;
		this.pending.add(path);
		if (this.pending.size > this.options.policy.maximumPendingChanges) {
			this.pending.clear();
			this.fail(new Error("The resource change queue exceeded its limit."));
		} else this.schedule(this.options.policy.changeDebounceMs);
	}
	baselineCompleted(): void {
		this.recovery = false;
		this.retryMs = this.options.policy.monitorRetryMs;
	}
	fail(error: unknown): void {
		if (this.closed) return;
		this.recovery = true;
		this.failureVersion++;
		clearTimeout(this.timer);
		this.timer = undefined;
		this.options.logger.warn(
			{ event: "library.monitor_degraded", err: error },
			"Resource monitoring degraded; existing entries retained.",
		);
		this.schedule(this.retryMs);
		this.retryMs = Math.min(
			this.retryMs * 2,
			this.options.policy.monitorMaximumRetryMs,
		);
	}
	private schedule(ms: number): void {
		if (this.closed || this.timer) return;
		// A fixed deadline prevents continuous changes from starving publication.
		this.timer = setTimeout(() => {
			this.timer = undefined;
			if (this.active) {
				this.schedule(this.options.policy.changeDebounceMs);
				return;
			}
			this.active = this.drain().finally(() => {
				this.active = undefined;
			});
		}, ms);
		this.timer.unref();
	}
	private async drain(): Promise<void> {
		if (this.closed) return;
		if (this.options.isBusy()) {
			this.schedule(this.options.policy.changeDebounceMs);
			return;
		}
		try {
			if (this.recovery) {
				const failureVersion = this.failureVersion;
				await this.options.reconcile();
				if (this.closed) return;
				if (this.failureVersion !== failureVersion) {
					this.schedule(this.retryMs);
					return;
				}
				this.baselineCompleted();
				this.options.logger.info(
					{ event: "library.monitor_recovered" },
					"Resource monitoring recovered.",
				);
			} else {
				const paths = [...this.pending];
				this.pending.clear();
				try {
					if (paths.length && !(await this.options.apply(paths)))
						for (const path of paths) this.enqueue(path);
				} catch (error) {
					if (this.closed) return;
					for (const path of paths) this.pending.add(path);
					if (this.pending.size > this.options.policy.maximumPendingChanges)
						this.pending.clear();
					throw error;
				}
			}
			if (this.pending.size)
				this.schedule(this.options.policy.changeDebounceMs);
		} catch (error) {
			this.fail(error);
		}
	}
	async close(): Promise<void> {
		this.closed = true;
		clearTimeout(this.timer);
		this.timer = undefined;
		this.pending.clear();
		await this.active;
	}
}
