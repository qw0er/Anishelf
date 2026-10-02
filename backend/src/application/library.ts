import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { Logger } from "pino";
import {
	defaultScanIntervalMinutes,
	type PersistentSettings,
} from "../config/model.js";
import { DomainError } from "../errors.js";
import type { LibraryIndex } from "../library/index.js";
import type {
	DirectoryInfo,
	DirectoryListing,
	FileEntry,
	FileInfo,
	LibraryEntry,
	LibraryStatus,
	ResourceInfo,
} from "../library/model.js";
import type { ScanState } from "../library/scan-state.js";
import {
	LibraryScanner,
	type ScanTraversalProgress,
} from "../library/scanner.js";
import type { ResolvedPlaybackSource } from "../playback/model.js";
import {
	checkResourceRoot,
	type OpenedResourceFile,
	ResourceAccess,
} from "../resources/access.js";

import { discoverExternalSubtitles } from "../subtitles/discovery.js";
import type { SubtitleDiscovery } from "../subtitles/model.js";

/** Minimal persistence boundary; implemented by PersistentConfiguration. */
export interface SettingsStore {
	readonly settings: Readonly<PersistentSettings>;
	update(settings: PersistentSettings): Promise<Readonly<PersistentSettings>>;
}
interface UpdateLibrarySettings {
	resourceRoot: string;
	scanIntervalMinutes?: number;
}

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

/** Explicit projection prevents new internal fields from leaking into public results. */
function directoryInfo(
	entry: Extract<LibraryEntry, { kind: "directory" }>,
): DirectoryInfo {
	return {
		kind: "directory",
		id: entry.id,
		parentId: entry.parentId,
		name: entry.name,
	};
}
function resourceInfo(entry: LibraryEntry): ResourceInfo {
	if (entry.kind === "directory") return directoryInfo(entry);
	return fileInfo(entry);
}
function fileInfo(entry: FileEntry): FileInfo {
	return {
		kind: "file",
		id: entry.id,
		parentId: entry.parentId,
		name: entry.name,
		sizeBytes: entry.sizeBytes,
		modifiedAt: entry.modifiedAt,
		mimeType: entry.mimeType,
	};
}

/** Owns library use cases, operation exclusion, scan state and snapshot publication. */
export class LibraryApplication {
	private rootEpoch = 0;
	private latest: ScanState | null = null;
	private pendingStart: Promise<ScanState> | undefined;
	private active: Promise<void> | undefined;
	private saving: Promise<Readonly<PersistentSettings>> | undefined;
	private controller: AbortController | undefined;
	private closed = false;
	private scanTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly logger: Logger;
	private readonly scanner: LibraryScanner;
	constructor(
		private readonly options: {
			configuration: SettingsStore;
			logger: Logger;
			index: LibraryIndex;
		},
	) {
		this.logger = options.logger.child({ module: "library" });
		this.scanner = new LibraryScanner(this.logger.child({ module: "scanner" }));
		this.scheduleScan();
	}

	get state(): ScanState | null {
		return this.latest === null ? null : copyState(this.latest);
	}

	getSettings(): Readonly<PersistentSettings> {
		return { ...this.options.configuration.settings };
	}

	async getStatus(): Promise<LibraryStatus> {
		// Capture index and task state together before the asynchronous availability check.
		const settings = this.getSettings();
		const revision = this.options.index.revision;
		const scannedAt = this.options.index.scannedAt;
		const scan = this.state;
		const rootIssue = await checkResourceRoot(settings);
		const error = rootIssue ?? (scan?.status === "failed" ? scan.error : null);
		return {
			ready: rootIssue === null,
			revision,
			scan,
			error,
			stale: scannedAt !== null && error !== null,
		};
	}

	getDirectory(id: string): DirectoryListing {
		return {
			directory: directoryInfo(this.options.index.getDirectory(id)),
			children: this.options.index.listChildren(id).map(resourceInfo),
		};
	}

	async getFile(id: string): Promise<FileInfo> {
		const entry = this.options.index.getFile(id);
		const settings = this.getSettings();
		const resources = await ResourceAccess.create(settings);
		const current = await resources.inspectFile(entry.relativePath);
		return {
			kind: "file",
			id: entry.id,
			parentId: entry.parentId,
			name: entry.name,
			sizeBytes: current.sizeBytes,
			modifiedAt: current.modifiedAt,
			mimeType: current.mimeType,
		};
	}

	get resourceRootEpoch(): number {
		return this.rootEpoch;
	}
	get hasSnapshot(): boolean {
		return this.options.index.scannedAt !== null;
	}

	async resolvePlaybackRoot(): Promise<string> {
		const epoch = this.rootEpoch;
		const resources = await ResourceAccess.create(this.getSettings());
		if (epoch !== this.rootEpoch)
			throw new DomainError("PLAYBACK_CONFLICT", "The resource root changed.");
		return resources.canonicalRoot;
	}

	async resolvePlaybackSource(id: string): Promise<ResolvedPlaybackSource> {
		const epoch = this.rootEpoch;
		const entry = this.options.index.getFile(id);
		const resources = await ResourceAccess.create(this.getSettings());
		const metadata = await resources.inspectSource(entry.relativePath);
		if (epoch !== this.rootEpoch)
			throw new DomainError("PLAYBACK_CONFLICT", "The resource root changed.");
		return {
			identity: {
				canonicalRoot: resources.canonicalRoot,
				fileId: entry.id,
				relativePath: entry.relativePath,
				sourceVersion: metadata.sourceVersion,
			},
			file: {
				...fileInfo(entry),
				sizeBytes: metadata.sizeBytes,
				modifiedAt: metadata.modifiedAt,
				mimeType: metadata.mimeType,
			},
			rootEpoch: epoch,
		};
	}

	async discoverSubtitles(id: string): Promise<SubtitleDiscovery> {
		const source = await this.resolvePlaybackSource(id);
		const resources = await ResourceAccess.create(this.getSettings());
		if (
			resources.canonicalRoot !== source.identity.canonicalRoot ||
			source.rootEpoch !== this.rootEpoch
		)
			throw new DomainError("PLAYBACK_CONFLICT", "The resource root changed.");
		const result = await discoverExternalSubtitles(
			resources,
			source.identity.relativePath,
			source.identity.sourceVersion,
		);
		const current = await resources.inspectSource(source.identity.relativePath);
		if (
			source.rootEpoch !== this.rootEpoch ||
			current.sourceVersion !== source.identity.sourceVersion
		)
			throw new DomainError(
				"PLAYBACK_CONFLICT",
				"The playback source changed.",
			);
		return result;
	}

	async openMedia(id: string): Promise<OpenedResourceFile> {
		// Pair the entry with its root before yielding, even if a settings save follows.
		const entry = this.options.index.getFile(id);
		const settings = this.getSettings();
		const resources = await ResourceAccess.create(settings);
		return resources.openFile(entry.relativePath);
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

	async updateSettings(
		input: UpdateLibrarySettings,
	): Promise<Readonly<PersistentSettings>> {
		if (this.closed || this.active || this.pendingStart || this.saving)
			throw new DomainError("SETTINGS_BUSY", "The library is busy.");
		clearTimeout(this.scanTimer);
		const next = { ...this.getSettings(), ...input };
		const previousRoot = this.getSettings().resourceRoot;
		this.saving = Promise.resolve()
			.then(async () => {
				const settings = await this.options.configuration.update(next);
				if (settings.resourceRoot !== previousRoot) {
					this.rootEpoch += 1;
					this.options.index.reset();
					this.latest = null;
				}
				return { ...settings };
			})
			.finally(() => {
				this.saving = undefined;
				this.scheduleScan();
			});
		const settings = await this.saving;
		if (!this.closed && settings.resourceRoot !== previousRoot) {
			try {
				await this.startScan();
			} catch (err) {
				this.logger.warn(
					{ event: "scan.settings_start_failed", err },
					"Settings saved, but the library scan could not be started.",
				);
			}
		}
		this.scheduleScan();
		return settings;
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
		const minutes = settings.scanIntervalMinutes ?? defaultScanIntervalMinutes;
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
			const resources = await ResourceAccess.create(settings);
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
