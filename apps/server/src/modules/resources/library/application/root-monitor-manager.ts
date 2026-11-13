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
}
interface RootMonitor {
	watcher: FilesystemWatcher;
	queue: ChangeQueue;
}
/** Owns per-scope monitor lifecycle and state; synchronization owns all index mutations. */
export class RootMonitorManager {
	private readonly monitors = new Map<string, RootMonitor>();
	private closed = false;
	constructor(
		private readonly options: {
			policy: DeepReadonly<LibraryPolicy>;
			logger: Logger;
		},
	) {}
	async sync(
		roots: readonly ResourceRootStatus[],
		actions: MonitorActions,
	): Promise<void> {
		if (this.closed) return;
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
		const entry = this.monitors.get(scopeId);
		if (entry?.watcher.state.status === "watching")
			entry.queue.baselineCompleted();
	}
	fail(scopeId: string, error: unknown): void {
		this.monitors.get(scopeId)?.queue.fail(error);
	}
	get state(): MonitorState {
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
		const entries = [...this.monitors.values()];
		this.monitors.clear();
		await Promise.all(
			entries.flatMap(({ watcher, queue }) => [watcher.close(), queue.close()]),
		);
	}
}
