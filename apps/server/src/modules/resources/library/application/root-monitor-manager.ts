import type { Logger } from "pino";
import type { DeepReadonly } from "../../../../shared/policy.js";
import type {
	ResourceRoot,
	ResourceRootStatus,
} from "../../resource-access/public.js";
import type { MonitorState } from "../domain/model.js";
import { FilesystemWatcher } from "../infrastructure/filesystem-watcher.js";
import type { LibraryPolicy } from "../policy.js";
import { ChangeQueue } from "./change-queue.js";

interface MonitorActions {
	isBusy(): boolean;
	apply(root: ResourceRoot, paths: readonly string[]): Promise<boolean>;
	reconcile(root: ResourceRoot): Promise<void>;
	refresh(roots: readonly ResourceRoot[], signal: AbortSignal): Promise<void>;
}
interface RootMonitor {
	watcher: FilesystemWatcher;
	queue: ChangeQueue;
}
/** Owns per-scope monitor lifecycle and state; synchronization owns all index mutations. */
export class RootMonitorManager {
	private readonly monitors = new Map<string, RootMonitor>();
	private readonly refreshFailures = new Set<string>();
	private refreshSchedule:
		| { roots: readonly ResourceRoot[]; actions: MonitorActions }
		| undefined;
	private refreshTimer: ReturnType<typeof setTimeout> | undefined;
	private refreshing: Promise<void> | undefined;
	private refreshController: AbortController | undefined;
	private closed = false;
	constructor(
		private readonly options: {
			policy: DeepReadonly<LibraryPolicy>;
			logger: Logger;
			mode: "events" | "periodic";
		},
	) {}
	async sync(
		roots: readonly ResourceRootStatus[],
		actions: MonitorActions,
	): Promise<void> {
		if (this.closed) return;
		if (this.options.mode === "periodic") {
			this.syncRefresh(roots, actions);
			return;
		}
		for (const [id, entry] of this.monitors)
			if (!roots.some((root) => root.scopeId === id)) {
				await Promise.all([entry.watcher.close(), entry.queue.close()]);
				this.monitors.delete(id);
			}
		for (const root of roots) {
			if (this.closed) return;
			let entry = this.monitors.get(root.scopeId);
			if (!entry) {
				const logger = this.options.logger.child({ scopeId: root.scopeId });
				const queue = new ChangeQueue({
					...this.options,
					logger,
					isBusy: actions.isBusy,
					apply: (paths) => actions.apply(root, paths),
					reconcile: () => actions.reconcile(root),
				});
				const watcher = new FilesystemWatcher({
					...this.options,
					logger,
					onChange: (path) => queue.enqueue(path),
					onError: (error) => queue.fail(error),
				});
				entry = { queue, watcher };
				this.monitors.set(root.scopeId, entry);
			}
			if (root.error) entry.queue.fail(root.error);
			else await this.start(root).catch(() => {}); // Other directories remain usable.
		}
	}
	async start(root: ResourceRoot, restart = false): Promise<void> {
		if (this.closed) return;
		const entry = this.monitors.get(root.scopeId);
		if (!entry) return;
		try {
			await entry.watcher.start(root.path, restart);
			if (entry.watcher.state.status !== "watching")
				throw new Error("Filesystem monitoring did not become ready.");
		} catch (error) {
			if (!entry.queue.degraded) entry.queue.fail(error);
			throw error;
		}
	}
	baselineCompleted(scopeId: string): void {
		if (this.refreshFailures.delete(scopeId))
			this.options.logger.info(
				{ event: "library.refresh_recovered", scopeId },
				"Scheduled resource refresh recovered.",
			);
		const entry = this.monitors.get(scopeId);
		if (entry?.watcher.state.status === "watching")
			entry.queue.baselineCompleted();
	}
	fail(scopeId: string, error: unknown): void {
		if (this.refreshSchedule?.roots.some((root) => root.scopeId === scopeId)) {
			const firstFailure = !this.refreshFailures.has(scopeId);
			this.refreshFailures.add(scopeId);
			if (firstFailure)
				this.options.logger.warn(
					{ event: "library.refresh_degraded", scopeId, err: error },
					"Scheduled resource refresh failed; existing entries retained.",
				);
		}
		this.monitors.get(scopeId)?.queue.fail(error);
	}
	get state(): MonitorState {
		if (this.refreshFailures.size)
			return {
				status: "degraded",
				error:
					"Scheduled resource refresh needs recovery. Retry or run a manual scan.",
			};
		if (this.refreshSchedule?.roots.length)
			return { status: "polling", error: null };
		const states = [...this.monitors.values()].map(({ watcher, queue }) =>
			queue.degraded
				? {
						status: "degraded" as const,
						error:
							"Resource monitoring needs recovery. Retry or run a manual scan.",
					}
				: watcher.state,
		);
		return (
			states.find((state) => state.status === "degraded") ??
			states.find((state) => state.status === "starting") ??
			states[0] ?? { status: "disabled", error: null }
		);
	}
	async close(): Promise<void> {
		this.closed = true;
		await this.reset();
	}
	async reset(): Promise<void> {
		this.refreshSchedule = undefined;
		this.refreshFailures.clear();
		clearTimeout(this.refreshTimer);
		this.refreshTimer = undefined;
		this.refreshController?.abort();
		const entries = [...this.monitors.values()];
		this.monitors.clear();
		await Promise.all([
			this.refreshing,
			...entries.flatMap(({ watcher, queue }) => [
				watcher.close(),
				queue.close(),
			]),
		]);
	}
	private syncRefresh(
		roots: readonly ResourceRootStatus[],
		actions: MonitorActions,
	) {
		if (!this.refreshSchedule?.roots.length && roots.length)
			this.options.logger.info(
				{
					event: "library.refresh_scheduled",
					intervalMs: this.options.policy.periodicRefreshMs,
				},
				"Scheduled resource refresh enabled.",
			);
		this.refreshSchedule = { roots, actions };
		const scopeIds = new Set(roots.map((root) => root.scopeId));
		for (const scopeId of this.refreshFailures)
			if (!scopeIds.has(scopeId)) this.refreshFailures.delete(scopeId);
		for (const { scopeId, error } of roots)
			if (error) this.fail(scopeId, error);
		this.scheduleRefresh(this.options.policy.periodicRefreshMs);
	}
	private scheduleRefresh(delay: number): void {
		if (
			this.closed ||
			this.refreshTimer ||
			this.refreshing ||
			!this.refreshSchedule?.roots.length
		)
			return;
		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = undefined;
			const schedule = this.refreshSchedule;
			if (!schedule?.roots.length || this.closed) return;
			if (schedule.actions.isBusy()) {
				this.scheduleRefresh(this.options.policy.monitorRetryMs);
				return;
			}
			const controller = new AbortController();
			this.refreshController = controller;
			this.refreshing = Promise.resolve()
				.then(() => schedule.actions.refresh(schedule.roots, controller.signal))
				.catch((err) => {
					if (!controller.signal.aborted)
						this.options.logger.warn(
							{ event: "library.refresh_failed", err },
							"Scheduled resource refresh could not complete.",
						);
				})
				.finally(() => {
					this.refreshing = undefined;
					this.refreshController = undefined;
					this.scheduleRefresh(this.options.policy.periodicRefreshMs);
				});
		}, delay).unref();
	}
}
