import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { Logger } from "pino";
import { DomainError } from "../../../shared/errors.js";
import type { DeepReadonly } from "../../../shared/policy.js";
import type {
	PersistentSettings,
	SettingsStore,
} from "../../../shared/settings.js";
import {
	checkResourceRoot,
	createResourceAccess,
} from "../../resource-access/files.js";
import {
	type LibraryRuntimePolicy,
	libraryRuntimePolicy,
} from "../domain/policy.js";
import type { ScanState } from "../domain/scan-state.js";
import type { LibraryIndex } from "../infrastructure/index.js";
import {
	LibraryScanner,
	type ScanTraversalProgress,
} from "../infrastructure/scanner.js";

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
	private pendingStart: Promise<ScanState> | undefined;
	private active: Promise<void> | undefined;
	private saving: Promise<Readonly<PersistentSettings>> | undefined;
	private controller: AbortController | undefined;
	private closed = false;
	private scanTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly logger: Logger;
	private readonly scanner: LibraryScanner;
	readonly policy: DeepReadonly<LibraryRuntimePolicy>;
	constructor(
		private readonly options: {
			configuration: SettingsStore;
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
		this.scheduleScan();
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
		clearTimeout(this.scanTimer);
		const settings = this.getSettings();
		const controller = new AbortController();
		this.controller = controller;
		// Reserve the operation before starting the asynchronous root preflight.
		this.pendingStart = Promise.resolve()
			.then(async () => {
				const issue = await checkResourceRoot(settings);
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
				).finally(() => {
					this.active = undefined;
					this.controller = undefined;
					this.scheduleScan();
				});
				return copyState(progress);
			})
			.finally(() => {
				this.pendingStart = undefined;
				if (!this.active) this.controller = undefined;
				if (!this.active) this.scheduleScan();
			});
		return copyState(await this.pendingStart);
	}

	async waitForCompletion(): Promise<ScanState | null> {
		await this.pendingStart;
		await this.active;
		return this.state;
	}

	/** Reserves the same exclusion gate used by manual and scheduled scans. */
	async withSettingsChange(
		operation: () => Promise<Readonly<PersistentSettings>>,
	): Promise<Readonly<PersistentSettings>> {
		if (this.closed || this.active || this.pendingStart || this.saving)
			throw new DomainError("SETTINGS_BUSY", "The library is busy.");
		clearTimeout(this.scanTimer);
		this.saving = Promise.resolve()
			.then(operation)
			.finally(() => {
				this.saving = undefined;
				this.scheduleScan();
			});
		return this.saving;
	}
	reset(): void {
		this.latest = null;
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
		clearTimeout(this.scanTimer);
		await Promise.allSettled([this.cancelScan(), this.saving]);
	}

	private scheduleScan(): void {
		clearTimeout(this.scanTimer);
		const settings = this.getSettings();
		const minutes =
			settings.scanIntervalMinutes ??
			this.policy.library.defaultScanIntervalMinutes;
		if (
			this.closed ||
			this.active ||
			this.pendingStart ||
			this.saving ||
			settings.resourceRoot === null ||
			minutes === 0
		)
			return;
		this.scanTimer = setTimeout(() => {
			void this.startScan().catch((err) => {
				this.logger.warn(
					{ event: "scan.scheduled_start_failed", err },
					"Scheduled library scan could not be started.",
				);
				this.scheduleScan();
			});
		}, minutes * 60000);
		this.scanTimer.unref();
	}

	private async runScan(
		progress: RunningScan,
		settings: Readonly<PersistentSettings>,
		signal: AbortSignal,
	): Promise<void> {
		const started = Date.now();
		this.logger.info(
			{ event: "scan.started", scanId: progress.id },
			"Library scan started.",
		);
		try {
			if (signal.aborted) return;
			const resources = await createResourceAccess(settings, this.policy);
			const traversal: ScanTraversalProgress = {
				id: progress.id,
				visitedCount: progress.visitedCount,
				matchedCount: progress.matchedCount,
				warnings: {
					count: progress.warnings.count,
					messages: [...progress.warnings.messages],
				},
			};
			const entries = await this.scanner.scan(
				resources,
				basename(settings.resourceRoot ?? "") || "root",
				traversal,
				signal,
				(current) => {
					progress.visitedCount = current.visitedCount;
					progress.matchedCount = current.matchedCount;
					progress.warnings = {
						count: current.warnings.count,
						messages: [...current.warnings.messages],
					};
				},
			);
			if (entries === null || signal.aborted) return;
			if (
				settings.resourceRoot !==
				this.options.configuration.settings.resourceRoot
			)
				throw new DomainError(
					"SCAN_FAILED",
					"Resource settings changed during scanning. Scan again.",
				);
			const finishedAt = new Date().toISOString();
			this.options.index.replace(entries, finishedAt);
			this.latest = { ...progress, status: "completed", finishedAt };
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
