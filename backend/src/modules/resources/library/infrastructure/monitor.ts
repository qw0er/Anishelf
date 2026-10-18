import { realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { Logger } from "pino";
import type { DeepReadonly } from "../../../../shared/policy.js";
import type { MonitorState } from "../domain/model.js";
import type { LibraryPolicy } from "../policy.js";

/** Owns native watchers and a bounded dirty-path queue, never writes the index. */
export class ResourceMonitor {
	private watcher: FSWatcher | undefined;
	private root: string | undefined;
	private starting: Promise<void> | undefined;
	private cancelReady: (() => void) | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private pending = new Set<string>();
	private active: Promise<void> | undefined;
	private stopped = false;
	private retryMs: number;
	private recovery = false;
	private current: MonitorState = { status: "disabled", error: null };
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
	get needsRecovery(): boolean {
		return this.recovery;
	}
	baselineCompleted(): void {
		if (this.current.status === "watching") {
			this.recovery = false;
			this.retryMs = this.options.policy.monitorRetryMs;
		}
	}
	get state(): MonitorState {
		return { ...this.current };
	}
	async start(root: string): Promise<void> {
		if (this.stopped) return;
		root = await realpath(root);
		if (this.stopped) return;
		if (
			this.root === root &&
			this.watcher &&
			this.current.status !== "degraded"
		) {
			await this.starting;
			return;
		}
		await this.reset();
		if (this.stopped) return;
		this.root = root;
		this.current = { status: "starting", error: null };
		const watcher = chokidar.watch(root, {
			ignoreInitial: true,
			followSymlinks: false,
			atomic: true,
			awaitWriteFinish: {
				stabilityThreshold: this.options.policy.writeStabilityMs,
				pollInterval: 100,
			},
		});
		this.watcher = watcher;
		this.starting = new Promise<void>((resolve, reject) => {
			this.cancelReady = resolve;
			watcher.once("ready", () => {
				if (this.watcher !== watcher) {
					resolve();
					return;
				}
				this.current = { status: "watching", error: null };
				this.options.logger.info(
					{ event: "library.monitor_started" },
					"Resource monitoring started.",
				);
				resolve();
			});
			watcher.on("error", (error) => {
				if (this.watcher !== watcher) return;
				reject(error);
				this.fail(error);
			});
		});
		watcher.on("all", (_event, path) => {
			if (this.watcher !== watcher || this.stopped) return;
			const local = relative(root, path);
			if (!local) {
				this.fail(
					new Error("The resource root changed; reconciliation is required."),
				);
				return;
			}
			if (isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`))
				return;
			this.pending.add(local);
			if (this.pending.size > this.options.policy.maximumPendingChanges) {
				this.pending.clear();
				this.fail(new Error("The resource change queue exceeded its limit."));
			} else this.schedule(this.options.policy.changeDebounceMs);
		});
		try {
			await this.starting;
		} finally {
			this.starting = undefined;
		}
	}
	private schedule(ms: number): void {
		if (this.stopped) return;
		// Keep a deadline even while changes continue arriving.
		if (this.timer) return;
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
	fail(error: unknown): void {
		if (this.stopped) return;
		this.current = {
			status: "degraded",
			error: "Resource monitoring needs recovery. Retry or run a manual scan.",
		};
		this.recovery = true;
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
	private async drain(): Promise<void> {
		if (this.stopped) return;
		if (this.options.isBusy()) {
			this.schedule(this.options.policy.changeDebounceMs);
			return;
		}
		try {
			if (this.recovery) {
				// A new native watch plus a baseline repairs known event loss.
				await this.watcher?.close();
				this.watcher = undefined;
				await this.options.reconcile();
				if (this.current.status !== "watching")
					throw new Error("Monitoring failed during reconciliation.");
				this.recovery = false;
				this.retryMs = this.options.policy.monitorRetryMs;
				this.options.logger.info(
					{ event: "library.monitor_recovered" },
					"Resource monitoring recovered.",
				);
			} else {
				const paths = [...this.pending];
				this.pending.clear();
				try {
					if (paths.length && !(await this.options.apply(paths)))
						for (const path of paths) this.pending.add(path);
				} catch (error) {
					for (const path of paths) this.pending.add(path);
					throw error;
				}
			}
			if (this.pending.size)
				this.schedule(this.options.policy.changeDebounceMs);
		} catch (error) {
			this.fail(error);
		}
	}
	async reset(): Promise<void> {
		clearTimeout(this.timer);
		this.timer = undefined;
		this.cancelReady?.();
		this.cancelReady = undefined;
		const watcher = this.watcher;
		this.watcher = undefined;
		this.root = undefined;
		this.pending.clear();
		await watcher?.close();
	}
	async close(): Promise<void> {
		this.stopped = true;
		await this.reset();
		await this.active;
		this.current = { status: "disabled", error: null };
	}
}
