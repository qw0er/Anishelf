import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { DomainError } from "../../../../shared/errors.js";
import type { DeepReadonly } from "../../../../shared/policy.js";
import type {
	PersistentSettings,
	SettingsStore,
} from "../../../system/public.js";
import type { ResourceRootApi } from "../../resource-access/public.js";
import {
	createResourceId,
	type LibraryChange,
	type LibraryEntry,
} from "../domain/model.js";
import type { ScanState } from "../domain/scan-state.js";
import { readChanges } from "../infrastructure/changes.js";
import type { LibraryIndex } from "../infrastructure/index.js";
import { ResourceMonitor } from "../infrastructure/monitor.js";
import {
	LibraryScanner,
	type ScanTraversalProgress,
} from "../infrastructure/scanner.js";
import { type LibraryRuntimePolicy, libraryRuntimePolicy } from "../policy.js";

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

export class ScanCoordinator {
	private latest: ScanState | null = null;
	private readonly snapshotListeners = new Set<
		(change: LibraryChange) => void
	>();
	private pendingStart: Promise<ScanState> | undefined;
	private active: Promise<void> | undefined;
	private saving: Promise<Readonly<PersistentSettings>> | undefined;
	private controller: AbortController | undefined;
	private closed = false;
	private readonly monitors = new Map<
		string,
		{ path: string; monitor: ResourceMonitor }
	>();
	private updating: Promise<void> | undefined;
	private readonly logger: Logger;
	private readonly scanner: LibraryScanner;
	readonly policy: DeepReadonly<LibraryRuntimePolicy>;
	constructor(
		private readonly options: {
			configuration: SettingsStore;
			rootFiles: ResourceRootApi;
			logger: Logger;
			index: LibraryIndex;
			policy?: DeepReadonly<LibraryRuntimePolicy>;
		},
	) {
		this.policy = options.policy ?? libraryRuntimePolicy;
		options.index.configure(this.policy.library);
		this.logger = options.logger.child({ module: "library" });
		this.scanner = new LibraryScanner(
			this.logger.child({ module: "scanner" }),
			this.policy,
		);
	}

	private async syncMonitors(
		settings: Readonly<PersistentSettings>,
		roots: Awaited<ReturnType<ResourceRootApi["getRoots"]>>,
	): Promise<void> {
		for (const [id, entry] of this.monitors)
			if (!roots.some((root) => root.id === id)) {
				await entry.monitor.close();
				this.monitors.delete(id);
			}
		for (const [index, root] of roots.entries()) {
			const path = settings.resourceRoots[index];
			if (!path) continue;
			let entry = this.monitors.get(root.id);
			if (!entry) {
				const monitor = new ResourceMonitor({
					policy: this.policy.library,
					logger: this.logger.child({ scopeId: root.id }),
					isBusy: () =>
						Boolean(
							this.active || this.pendingStart || this.saving || this.updating,
						),
					apply: (paths) => this.applyChanges(root.id, path, paths),
					reconcile: () => this.recoverRoot(root.id, path),
				});
				entry = { path, monitor };
				this.monitors.set(root.id, entry);
			}
			if (root.error)
				entry.monitor.fail(
					new DomainError(root.error.code, root.error.message),
				);
			else
				await entry.monitor
					.start(path)
					.catch((error) => entry?.monitor.fail(error));
		}
	}
	private async recoverRoot(scopeId: string, path: string): Promise<void> {
		if (this.closed) return;
		if (this.options.index.scannedAt === null) {
			await this.startScan();
			await this.waitForCompletion();
			if (this.state?.status !== "completed")
				throw new Error("Reconciliation failed.");
			return;
		}
		const settings = this.getSettings();
		const entry = this.monitors.get(scopeId);
		if (!entry) return;
		this.updating = (async () => {
			const resources = await this.options.rootFiles.openRoot(
				{ ...settings, resourceRoots: [path] },
				this.policy,
			);
			await entry.monitor.start(path);
			const progress: ScanTraversalProgress = {
				id: randomUUID(),
				visitedCount: 0,
				matchedCount: 0,
				warnings: { count: 0, messages: [] },
			};
			const mount = settings.resourceRoots.length > 1;
			const root = this.options.index.findPath("", scopeId);
			const scanned = await this.scanner.scan(
				resources,
				root?.name ?? "Resources",
				progress,
				new AbortController().signal,
				undefined,
				mount,
			);
			if (!scanned || progress.warnings.count)
				throw new Error(
					"Reconciliation could not read every resource; previous entries retained.",
				);
			if (
				this.closed ||
				JSON.stringify(settings.resourceRoots) !==
					JSON.stringify(this.getSettings().resourceRoots)
			)
				return;
			const removals = root
				? root.id === "root"
					? this.options.index.listChildren(root.id).map((child) => child.id)
					: [root.id]
				: [];
			const directoryIds = this.options.index.apply(scanned, removals);
			entry.monitor.baselineCompleted();
			if (
				this.latest?.status === "failed" &&
				this.latest.error.code === "RESOURCE_ROOT_UNAVAILABLE"
			)
				this.latest = null;
			if (directoryIds.length) this.notifySnapshotChanged(directoryIds);
			this.logger.info(
				{
					event: "library.root_reconciled",
					scopeId,
					revision: this.options.index.revision,
				},
				"Resource directory monitoring reconciled.",
			);
		})();
		try {
			await this.updating;
		} finally {
			this.updating = undefined;
		}
	}

	onSnapshotChanged(listener: (change: LibraryChange) => void): () => void {
		this.snapshotListeners.add(listener);
		return () => {
			this.snapshotListeners.delete(listener);
		};
	}
	private notifySnapshotChanged(
		directoryIds: readonly string[] | null = null,
	): void {
		for (const listener of this.snapshotListeners) {
			try {
				listener({ revision: this.options.index.revision, directoryIds });
			} catch (err) {
				this.logger.warn(
					{ event: "scan.listener_failed", err },
					"Library snapshot listener failed.",
				);
			}
		}
	}

	get state(): ScanState | null {
		return this.latest === null ? null : copyState(this.latest);
	}

	private getSettings() {
		return { ...this.options.configuration.settings };
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
		this.controller = controller;
		// Reserve the operation before starting the asynchronous root preflight.
		this.pendingStart = Promise.resolve()
			.then(async () => {
				await this.updating;
				const issue = await this.options.rootFiles.checkRoot(settings);
				const roots = await this.options.rootFiles.getRoots(settings);
				await this.syncMonitors(settings, roots);
				if (issue) throw new DomainError(issue.code, issue.message);
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
					controller.signal,
					roots,
				).finally(() => {
					this.active = undefined;
					this.controller = undefined;
				});
				return copyState(progress);
			})
			.finally(() => {
				this.pendingStart = undefined;
				if (!this.active) this.controller = undefined;
			});
		return copyState(await this.pendingStart);
	}

	async waitForCompletion(): Promise<ScanState | null> {
		await this.pendingStart;
		await this.active;
		return this.state;
	}

	/** Reserves the same exclusion gate used by manual scans and incremental publications. */
	async withSettingsChange(
		operation: () => Promise<Readonly<PersistentSettings>>,
	): Promise<Readonly<PersistentSettings>> {
		if (
			this.closed ||
			this.active ||
			this.pendingStart ||
			this.saving ||
			this.updating
		)
			throw new DomainError("SETTINGS_BUSY", "The library is busy.");

		this.saving = Promise.resolve()
			.then(operation)
			.finally(() => {
				this.saving = undefined;
			});
		return this.saving;
	}
	async reset(): Promise<void> {
		await Promise.all(
			[...this.monitors.values()].map(({ monitor }) => monitor.close()),
		);
		this.monitors.clear();
		this.latest = null;
		this.notifySnapshotChanged();
	}
	get isClosed(): boolean {
		return this.closed;
	}
	async cancelScan(): Promise<void> {
		this.controller?.abort();
		await this.pendingStart?.catch(() => {});
		await this.active;
	}

	async close(): Promise<void> {
		this.closed = true;
		this.snapshotListeners.clear();

		await Promise.allSettled([
			...[...this.monitors.values()].map(({ monitor }) => monitor.close()),
			this.cancelScan(),
			this.saving,
			this.updating,
		]);
	}

	get monitorState() {
		const states = [...this.monitors.values()].map(
			({ monitor }) => monitor.state,
		);
		return (
			states.find((state) => state.status === "degraded") ??
			states.find((state) => state.status === "starting") ??
			states[0] ?? { status: "disabled" as const, error: null }
		);
	}

	private async applyChanges(
		scopeId: string,
		path: string,
		paths: readonly string[],
	): Promise<boolean> {
		if (
			this.closed ||
			this.active ||
			this.pendingStart ||
			this.saving ||
			this.updating ||
			this.options.index.scannedAt === null
		)
			return false;
		const settings = this.getSettings();
		this.updating = (async () => {
			const resources = await this.options.rootFiles.openRoot(
				{ ...settings, resourceRoots: [path] },
				this.policy,
			);
			const batch = await readChanges(
				resources,
				this.options.index,
				paths,
				this.policy.resourceAccess.videoMimeTypes,
			);
			if (
				this.closed ||
				JSON.stringify(settings.resourceRoots) !==
					JSON.stringify(this.getSettings().resourceRoots)
			)
				return;
			const directoryIds = this.options.index.apply(
				batch.upserts,
				batch.removals,
			);
			if (!directoryIds.length) return;
			this.notifySnapshotChanged(directoryIds);
			this.logger.info(
				{
					event: "library.incremental_published",
					scopeId,
					paths: paths.length,
					directories: directoryIds.length,
					revision: this.options.index.revision,
				},
				"Incremental resource changes published.",
			);
		})();
		try {
			await this.updating;
		} finally {
			this.updating = undefined;
		}
		return true;
	}

	private async runScan(
		progress: RunningScan,
		settings: Readonly<PersistentSettings>,
		signal: AbortSignal,
		roots: Awaited<ReturnType<ResourceRootApi["getRoots"]>>,
	): Promise<void> {
		const started = Date.now();
		this.logger.info(
			{ event: "scan.started", scanId: progress.id },
			"Library scan started.",
		);
		try {
			if (signal.aborted) return;

			const multiple = roots.length > 1;
			const entries: LibraryEntry[] = multiple
				? [
						{
							kind: "directory",
							id: "root",
							parentId: null,
							name: "Resources",
							relativePath: "",
						},
					]
				: [];
			const previous = this.options.index.snapshot;
			const traversal: ScanTraversalProgress = {
				id: progress.id,
				visitedCount: progress.visitedCount,
				matchedCount: progress.matchedCount,
				warnings: {
					count: progress.warnings.count,
					messages: [...progress.warnings.messages],
				},
			};
			let completed = 0;
			const updateProgress = () => {
				progress.visitedCount = traversal.visitedCount;
				progress.matchedCount = traversal.matchedCount;
				progress.warnings = {
					count: traversal.warnings.count,
					messages: [...traversal.warnings.messages],
				};
			};
			for (let index = 0; index < roots.length; index++) {
				if (signal.aborted) return;
				const root = roots[index];
				if (!root) continue;
				const name =
					roots.filter((candidate) => candidate.name === root.name).length > 1
						? `${root.name} (${root.id.slice(0, 6)})`
						: root.name;
				const warningsBefore = traversal.warnings.count;
				try {
					const resources = await this.options.rootFiles.openRoot(
						{
							...settings,
							resourceRoots: [settings.resourceRoots[index] as string],
						},
						this.policy,
					);
					const scanned = await this.scanner.scan(
						resources,
						name,
						traversal,
						signal,
						updateProgress,
						multiple,
					);
					if (scanned === null || signal.aborted) return;
					entries.push(...scanned);
					if (traversal.warnings.count === warningsBefore)
						this.monitors.get(root.id)?.monitor.baselineCompleted();
					completed++;
					this.logger.debug(
						{
							event: "scan.root_completed",
							scanId: progress.id,
							scopeId: root.id,
						},
						"Resource directory scan completed.",
					);
				} catch (err) {
					if (signal.aborted) return;
					if (
						!(err instanceof DomainError) ||
						err.code !== "RESOURCE_ROOT_UNAVAILABLE"
					)
						throw err;
					this.monitors.get(root.id)?.monitor.fail(err);
					const retained = [...previous.entriesById.values()].filter(
						(entry) => entry.scopeId === root.id,
					);
					entries.push(...retained);
					if (!retained.length)
						entries.push({
							kind: "directory",
							id: multiple
								? createResourceId("directory", "", root.id)
								: "root",
							parentId: multiple ? "root" : null,
							scopeId: root.id,
							name,
							relativePath: "",
						});
					traversal.warnings.count++;
					const message =
						"A resource directory is unavailable; its previous index was retained.";
					if (
						!traversal.warnings.messages.includes(message) &&
						traversal.warnings.messages.length <
							this.policy.library.warningMessageLimit
					)
						traversal.warnings.messages = [
							...traversal.warnings.messages,
							message,
						];
					this.logger.warn(
						{
							event: "scan.root_failed",
							scanId: progress.id,
							scopeId: root.id,
							retainedEntries: retained.length,
							errorName: err instanceof Error ? err.name : "unknown",
						},
						"Resource directory scan failed; retaining its previous index.",
					);
					updateProgress();
				}
			}
			if (completed === 0)
				throw new DomainError(
					"RESOURCE_ROOT_UNAVAILABLE",
					"All resource directories are unavailable.",
				);
			if (signal.aborted) return;
			if (
				JSON.stringify(settings.resourceRoots) !==
				JSON.stringify(this.options.configuration.settings.resourceRoots)
			)
				throw new DomainError(
					"SCAN_FAILED",
					"Resource settings changed during scanning. Scan again.",
				);
			const finishedAt = new Date().toISOString();
			this.options.index.replace(entries, finishedAt);
			this.latest = { ...progress, status: "completed", finishedAt };
			this.notifySnapshotChanged();
			this.logger.info(
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
				for (const { monitor } of this.monitors.values()) monitor.fail(err);
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
			this.logger.error(
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
				this.logger.info(
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
}
