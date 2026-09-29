import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { Logger } from "pino";
import type {
	DirectoryDto,
	DirectoryResponse,
	FileDto,
	LibraryResponse,
	ResourceDto,
	UpdateSettingsRequest,
} from "../contracts/api.js";
import type { PersistentSettings } from "../contracts/config.js";
import type { ScanState } from "../contracts/library.js";
import { DomainError } from "../errors.js";
import type { LibraryIndex } from "../library/index.js";
import type { LibraryEntry } from "../library/model.js";
import { LibraryScanner } from "../library/scanner.js";
import {
	checkResourceRoot,
	type OpenedResourceFile,
	ResourceAccess,
} from "../resources/access.js";

/** Minimal persistence boundary; implemented by PersistentConfiguration. */
export interface SettingsStore {
	readonly settings: Readonly<PersistentSettings>;
	update(settings: PersistentSettings): Promise<Readonly<PersistentSettings>>;
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
function directoryDto(
	entry: Extract<LibraryEntry, { kind: "directory" }>,
): DirectoryDto {
	return {
		kind: "directory",
		id: entry.id,
		parentId: entry.parentId,
		name: entry.name,
	};
}
function resourceDto(entry: LibraryEntry): ResourceDto {
	if (entry.kind === "directory") return directoryDto(entry);
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
	private latest: ScanState | null = null;
	private pendingStart: Promise<ScanState> | undefined;
	private active: Promise<void> | undefined;
	private saving: Promise<Readonly<PersistentSettings>> | undefined;
	private controller: AbortController | undefined;
	private closed = false;
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
	}

	get state(): ScanState | null {
		return this.latest === null ? null : copyState(this.latest);
	}

	getSettings(): Readonly<PersistentSettings> {
		return { ...this.options.configuration.settings };
	}

	async getStatus(): Promise<LibraryResponse> {
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

	getDirectory(id: string): DirectoryResponse {
		return {
			directory: directoryDto(this.options.index.getDirectory(id)),
			children: this.options.index.listChildren(id).map(resourceDto),
		};
	}

	async getFile(id: string): Promise<FileDto> {
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

	async updateSettings(
		input: UpdateSettingsRequest,
	): Promise<Readonly<PersistentSettings>> {
		if (this.closed || this.active || this.pendingStart || this.saving)
			throw new DomainError("SETTINGS_BUSY", "The library is busy.");
		const next = { ...input };
		const previousRoot = this.getSettings().resourceRoot;
		this.saving = Promise.resolve()
			.then(async () => {
				const settings = await this.options.configuration.update(next);
				if (settings.resourceRoot !== previousRoot) {
					this.options.index.reset();
					this.latest = null;
				}
				return { ...settings };
			})
			.finally(() => {
				this.saving = undefined;
			});
		return this.saving;
	}

	async cancelScan(): Promise<void> {
		this.controller?.abort();
		await this.pendingStart?.catch(() => {});
		await this.active;
	}

	async close(): Promise<void> {
		this.closed = true;
		await Promise.allSettled([this.cancelScan(), this.saving]);
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
			const entries = await this.scanner.scan(
				resources,
				basename(settings.resourceRoot ?? "") || "root",
				progress,
				signal,
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
