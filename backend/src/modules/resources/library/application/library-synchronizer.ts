import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { DomainError } from "../../../../shared/errors.js";
import type {
	PersistentSettings,
	SettingsStore,
} from "../../../system/public.js";
import type {
	ResourceRoot,
	ResourceRootsApi,
} from "../../resource-access/public.js";
import type { LibraryChange } from "../domain/model.js";
import type { ScanState } from "../domain/scan-state.js";
import type { LibraryIndex } from "../infrastructure/index.js";
import type { ChangeProcessor } from "./change-processor.js";
import type { RootMonitorManager } from "./root-monitor-manager.js";
import type { ScanRunner } from "./scan-runner.js";

type RunningScan = Extract<ScanState, { status: "running" }>;
function copyState(state: ScanState): ScanState {
	const copy = {
		...state,
		warnings: {
			count: state.warnings.count,
			messages: [...state.warnings.messages],
		},
	};
	return copy.status === "failed"
		? { ...copy, error: { ...copy.error } }
		: copy;
}

/** Sole owner of publication exclusion, task cancellation, settings coordination and shutdown. */
export class LibrarySynchronizer {
	private latest: ScanState | null = null;
	private readonly listeners = new Set<(change: LibraryChange) => void>();
	private pendingStart: Promise<ScanState> | undefined;
	private active: Promise<void> | undefined;
	private saving: Promise<Readonly<PersistentSettings>> | undefined;
	private updating: Promise<void> | undefined;
	private scanController: AbortController | undefined;
	private updateController: AbortController | undefined;
	private closed = false;
	private closing: Promise<void> | undefined;
	constructor(
		private readonly options: {
			configuration: Pick<SettingsStore, "settings">;
			roots: ResourceRootsApi;
			index: LibraryIndex;
			scans: ScanRunner;
			changes: ChangeProcessor;
			monitoring: RootMonitorManager;
			logger: Logger;
		},
	) {}
	get state(): ScanState | null {
		return this.latest === null ? null : copyState(this.latest);
	}
	get monitorState() {
		return this.options.monitoring.state;
	}
	get isClosed(): boolean {
		return this.closed;
	}
	get isBusy(): boolean {
		return (
			this.closed ||
			Boolean(this.active || this.pendingStart || this.saving || this.updating)
		);
	}
	private getSettings(): Readonly<PersistentSettings> {
		const settings = this.options.configuration.settings;
		return { ...settings, resourceRoots: [...settings.resourceRoots] };
	}
	onSnapshotChanged(listener: (change: LibraryChange) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	private notify(directoryIds: readonly string[] | null = null): void {
		for (const listener of this.listeners)
			try {
				listener({ revision: this.options.index.revision, directoryIds });
			} catch (err) {
				this.options.logger.warn(
					{ event: "scan.listener_failed", err },
					"Library snapshot listener failed.",
				);
			}
	}
	/** Baselines, root recovery and incremental patches share the same final validation and notification. */
	private publish(
		settings: Readonly<PersistentSettings>,
		signal: AbortSignal,
		commit: () => readonly string[] | null,
	): boolean {
		if (this.closed || signal.aborted) return false;
		if (
			JSON.stringify(settings.resourceRoots) !==
			JSON.stringify(this.options.configuration.settings.resourceRoots)
		)
			throw new DomainError(
				"SCAN_FAILED",
				"Resource settings changed during scanning. Scan again.",
			);
		const directories = commit();
		if (directories === null || directories.length) this.notify(directories);
		return true;
	}
	async startScan(): Promise<ScanState> {
		if (this.closed)
			throw new DomainError("SCAN_FAILED", "The library is shutting down.");
		if (this.saving)
			throw new DomainError("SETTINGS_BUSY", "Settings are being saved.");
		if (this.pendingStart) return copyState(await this.pendingStart);
		if (this.active && this.latest) return copyState(this.latest);
		const settings = this.getSettings();
		const controller = new AbortController();
		this.scanController = controller;
		// Reserve the gate before asynchronous directory inspection and watcher initialization.
		this.pendingStart = Promise.resolve()
			.then(async () => {
				await this.updating;
				const selection = await this.options.roots.inspect(settings);
				await this.options.monitoring.sync(selection.roots, {
					isBusy: () => this.isBusy,
					apply: (root, paths) => this.applyChanges(root, paths),
					reconcile: (root) => this.reconcile(root),
				});
				if (selection.issue)
					throw new DomainError(selection.issue.code, selection.issue.message);
				if (controller.signal.aborted || this.closed)
					throw new DomainError(
						"SCAN_FAILED",
						"The library scan was cancelled while starting.",
					);
				const progress: RunningScan = {
					id: randomUUID(),
					status: "running",
					startedAt: new Date().toISOString(),
					finishedAt: null,
					visitedCount: 0,
					matchedCount: 0,
					warnings: { count: 0, messages: [] },
				};
				this.latest = progress;
				this.active = this.runScan(
					progress,
					settings,
					selection.roots,
					controller.signal,
				).finally(() => {
					this.active = undefined;
					this.scanController = undefined;
				});
				return copyState(progress);
			})
			.finally(() => {
				this.pendingStart = undefined;
				if (!this.active) this.scanController = undefined;
			});
		return copyState(await this.pendingStart);
	}
	private async runScan(
		progress: RunningScan,
		settings: Readonly<PersistentSettings>,
		roots: readonly ResourceRoot[],
		signal: AbortSignal,
	): Promise<void> {
		const started = Date.now();
		this.options.logger.info(
			{ event: "scan.started", scanId: progress.id },
			"Library scan started.",
		);
		try {
			if (signal.aborted) return;
			const entries = await this.options.scans.baseline(
				roots,
				this.options.index.snapshot,
				progress,
				signal,
				(result) => {
					if (result.healthy)
						this.options.monitoring.baselineCompleted(result.scopeId);
					else if (result.error)
						this.options.monitoring.fail(result.scopeId, result.error);
				},
			);
			if (entries === null || signal.aborted) return;
			const finishedAt = new Date().toISOString();
			if (
				!this.publish(settings, signal, () => {
					this.options.index.replace(entries, finishedAt);
					this.latest = { ...progress, status: "completed", finishedAt };
					return null;
				})
			)
				return;
			this.options.logger.info(
				{
					event: "scan.completed",
					scanId: progress.id,
					visitedCount: progress.visitedCount,
					matchedCount: progress.matchedCount,
					warningCount: progress.warnings.count,
					durationMs: Date.now() - started,
				},
				"Library scan completed.",
			);
		} catch (err) {
			if (signal.aborted) return;
			const code =
				err instanceof DomainError && err.code === "RESOURCE_ROOT_UNAVAILABLE"
					? "RESOURCE_ROOT_UNAVAILABLE"
					: "SCAN_FAILED";
			if (code === "RESOURCE_ROOT_UNAVAILABLE")
				for (const root of roots)
					this.options.monitoring.fail(root.scopeId, err);
			this.latest = {
				...progress,
				status: "failed",
				finishedAt: new Date().toISOString(),
				error: {
					code,
					message:
						code === "RESOURCE_ROOT_UNAVAILABLE"
							? "The resource directory is missing or unreadable. Fix it and scan again."
							: "The library scan failed. Check the logs and scan again.",
				},
			};
			this.options.logger.error(
				{
					event: "scan.failed",
					scanId: progress.id,
					err,
					durationMs: Date.now() - started,
				},
				"Library scan failed.",
			);
		} finally {
			if (signal.aborted) {
				this.latest = {
					...progress,
					status: "cancelled",
					finishedAt: new Date().toISOString(),
				};
				this.options.logger.info(
					{
						event: "scan.cancelled",
						scanId: progress.id,
						durationMs: Date.now() - started,
					},
					"Library scan cancelled.",
				);
			}
		}
	}
	private async withUpdate(
		root: ResourceRoot,
		operation: (
			settings: Readonly<PersistentSettings>,
			signal: AbortSignal,
		) => Promise<void>,
	): Promise<boolean> {
		if (this.isBusy || this.options.index.scannedAt === null) return false;
		const settings = this.getSettings();
		if (!settings.resourceRoots.includes(root.path)) return false;
		const controller = new AbortController();
		this.updateController = controller;
		this.updating = Promise.resolve().then(() => {
			controller.signal.throwIfAborted();
			return operation(settings, controller.signal);
		});
		try {
			await this.updating;
		} finally {
			this.updating = undefined;
			this.updateController = undefined;
		}
		return true;
	}
	async refreshPaths(scopeId: string, paths: readonly string[]): Promise<void> {
		const root = await this.options.roots.resolve(this.getSettings(), scopeId);
		if (!(await this.applyChanges(root, paths)))
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"Resource synchronization is busy. Retry import.",
			);
	}
	private applyChanges(
		root: ResourceRoot,
		paths: readonly string[],
	): Promise<boolean> {
		return this.withUpdate(root, async (settings, signal) => {
			const batch = await this.options.changes.read(root, paths, signal);
			const before = this.options.index.revision;
			if (
				!this.publish(settings, signal, () =>
					this.options.index.apply(batch.upserts, batch.removals),
				) ||
				before === this.options.index.revision
			)
				return;
			this.options.logger.info(
				{
					event: "library.incremental_published",
					scopeId: root.scopeId,
					paths: paths.length,
					revision: this.options.index.revision,
				},
				"Incremental resource changes published.",
			);
		});
	}
	private async reconcile(root: ResourceRoot): Promise<void> {
		if (this.closed) return;
		if (this.options.index.scannedAt === null) {
			await this.startScan();
			await this.waitForCompletion();
			if (this.state?.status !== "completed")
				throw new Error("Reconciliation failed.");
			return;
		}
		const applied = await this.withUpdate(root, async (settings, signal) => {
			await this.options.monitoring.start(root, true);
			const entries = await this.options.scans.reconcile(
				root,
				settings.resourceRoots.length > 1,
				signal,
			);
			if (entries === null) return;
			if (
				!this.publish(settings, signal, () => {
					const directories = this.options.index.replaceScope(
						root.scopeId,
						entries,
					);
					if (
						this.latest?.status === "failed" &&
						this.latest.error.code === "RESOURCE_ROOT_UNAVAILABLE"
					)
						this.latest = null;
					return directories;
				})
			)
				return;
			this.options.monitoring.baselineCompleted(root.scopeId);
			this.options.logger.info(
				{
					event: "library.root_reconciled",
					scopeId: root.scopeId,
					revision: this.options.index.revision,
				},
				"Resource directory monitoring reconciled.",
			);
		});
		if (!applied && !this.closed)
			throw new DomainError("SETTINGS_BUSY", "The library is busy.");
	}
	async withSettingsChange(
		operation: () => Promise<Readonly<PersistentSettings>>,
	): Promise<Readonly<PersistentSettings>> {
		if (this.isBusy)
			throw new DomainError("SETTINGS_BUSY", "The library is busy.");
		this.saving = Promise.resolve()
			.then(operation)
			.finally(() => {
				this.saving = undefined;
			});
		return this.saving;
	}
	async reset(): Promise<void> {
		await this.options.monitoring.reset();
		this.latest = null;
		this.notify();
	}
	async waitForCompletion(): Promise<ScanState | null> {
		await this.pendingStart;
		await this.active;
		return this.state;
	}
	async cancelScan(): Promise<void> {
		this.scanController?.abort();
		await this.pendingStart?.catch(() => {});
		await this.active;
	}
	close(): Promise<void> {
		if (this.closing) return this.closing;
		this.closed = true;
		this.listeners.clear();
		this.scanController?.abort();
		this.updateController?.abort();
		this.closing = Promise.allSettled([
			this.options.monitoring.close(),
			this.cancelScan(),
			this.saving,
			this.updating,
		]).then(() => {});
		return this.closing;
	}
}
