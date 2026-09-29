import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import type { Logger } from "pino";
import type { PersistentSettings } from "../contracts/config.js";
import type {
	DirectoryEntry,
	LibraryEntry,
	ScanState,
} from "../contracts/library.js";
import { DomainError } from "../errors.js";
import { getVideoMimeType, ResourceAccess } from "../resources/access.js";
import { createResourceId, type LibraryIndex } from "./index.js";

const concurrency = 8;
const warningMessageLimit = 5;
type RunningScan = Extract<ScanState, { status: "running" }>;
type ScanTask =
	| { kind: "directory"; entry: DirectoryEntry }
	| { kind: "file"; name: string; relativePath: string; parentId: string };

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

/** Coordinates one manual scan and publishes only a completed candidate. */
export class LibraryScanner {
	private latest: ScanState | null = null;
	private active: Promise<void> | undefined;
	private controller: AbortController | undefined;
	private closed = false;
	private updatingSettings = false;
	private readonly logger: Logger;

	constructor(
		private readonly options: {
			index: LibraryIndex;
			settings: () => Readonly<PersistentSettings>;
			logger: Logger;
		},
	) {
		this.logger = options.logger.child({ module: "scanner" });
	}

	get state(): ScanState | null {
		return this.latest === null ? null : copyState(this.latest);
	}

	/** Returns immediately; another start during a scan reuses its ID and progress. */
	start(): ScanState {
		if (this.updatingSettings)
			throw new DomainError("SETTINGS_BUSY", "Settings are being saved.");
		if (this.closed)
			throw new DomainError("SCAN_FAILED", "The scanner is shutting down.");
		if (this.active && this.latest) return copyState(this.latest);
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
		const controller = new AbortController();
		this.controller = controller;
		this.active = Promise.resolve()
			.then(() => this.run(progress, controller.signal))
			.finally(() => {
				this.active = undefined;
				this.controller = undefined;
			});
		return copyState(progress);
	}

	async waitForCompletion(): Promise<ScanState | null> {
		await this.active;
		return this.state;
	}

	/** Serialize settings changes against scans and discard the old root's snapshot. */
	async updateSettings(
		save: () => Promise<Readonly<PersistentSettings>>,
	): Promise<Readonly<PersistentSettings>> {
		if (this.active || this.updatingSettings || this.closed)
			throw new DomainError("SETTINGS_BUSY", "The library is busy.");
		this.updatingSettings = true;
		const previousRoot = this.options.settings().resourceRoot;
		try {
			const settings = await save();
			if (settings.resourceRoot !== previousRoot) {
				this.options.index.reset();
				this.latest = null;
			}
			return settings;
		} finally {
			this.updatingSettings = false;
		}
	}

	/** Stop scheduling work and wait for outstanding filesystem operations to settle. */
	async cancel(): Promise<void> {
		this.controller?.abort();
		await this.active;
	}

	async close(): Promise<void> {
		this.closed = true;
		await this.cancel();
	}

	private async run(progress: RunningScan, signal: AbortSignal): Promise<void> {
		const started = Date.now();
		this.logger.info(
			{ event: "scan.started", scanId: progress.id },
			"Library scan started.",
		);
		try {
			if (signal.aborted) return;
			const settings = { ...this.options.settings() };
			const resources = await ResourceAccess.create(settings);
			const root: DirectoryEntry = {
				kind: "directory",
				id: "root",
				parentId: null,
				name: basename(settings.resourceRoot ?? "") || "root",
				relativePath: "",
			};
			const entries: LibraryEntry[] = [];
			const queue: ScanTask[] = [{ kind: "directory", entry: root }];
			let cursor = 0;
			while (cursor < queue.length && !signal.aborted) {
				const batch = queue.slice(cursor, cursor + concurrency);
				cursor += batch.length;
				await Promise.all(
					batch.map((task) =>
						this.visit(task, resources, entries, queue, progress, signal),
					),
				);
			}
			if (signal.aborted) return;
			// Losing the root during traversal must not publish a misleading partial index.
			try {
				await resources.readDirectory();
			} catch (cause) {
				throw new DomainError(
					"RESOURCE_ROOT_UNAVAILABLE",
					"The resource directory is unavailable.",
					{ cause },
				);
			}
			if (signal.aborted) return;
			if (settings.resourceRoot !== this.options.settings().resourceRoot)
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

	private async visit(
		task: ScanTask,
		resources: ResourceAccess,
		entries: LibraryEntry[],
		queue: ScanTask[],
		progress: RunningScan,
		signal: AbortSignal,
	): Promise<void> {
		if (signal.aborted) return;
		const relativePath =
			task.kind === "directory" ? task.entry.relativePath : task.relativePath;
		try {
			if (task.kind === "file") {
				const metadata = await resources.inspectFile(relativePath);
				if (signal.aborted) return;
				entries.push({
					kind: "file",
					id: createResourceId("file", relativePath),
					parentId: task.parentId,
					name: task.name,
					relativePath,
					...metadata,
				});
				progress.matchedCount++;
				return;
			}
			const children = await resources.readDirectory(relativePath);
			if (signal.aborted) return;
			entries.push(task.entry);
			for (const child of children) {
				progress.visitedCount++;
				const childPath = join(relativePath, child.name);
				if (child.isSymbolicLink()) continue;
				if (child.isDirectory()) {
					queue.push({
						kind: "directory",
						entry: {
							kind: "directory",
							id: createResourceId("directory", childPath),
							parentId: task.entry.id,
							name: child.name,
							relativePath: childPath,
						},
					});
				} else if (child.isFile() && getVideoMimeType(child.name) !== null) {
					queue.push({
						kind: "file",
						name: child.name,
						relativePath: childPath,
						parentId: task.entry.id,
					});
				}
			}
		} catch (cause) {
			if (task.kind === "directory" && task.entry.id === "root")
				throw new DomainError(
					"RESOURCE_ROOT_UNAVAILABLE",
					"The resource directory is unavailable.",
					{ cause },
				);
			progress.warnings.count++;
			const messages = [...progress.warnings.messages];
			const message =
				task.kind === "directory"
					? "A directory could not be scanned; its contents were skipped."
					: "A video file could not be read and was skipped.";
			if (messages.length < warningMessageLimit && !messages.includes(message))
				messages.push(message);
			progress.warnings.messages = messages;
			this.logger.warn(
				{
					event: "scan.resource_skipped",
					scanId: progress.id,
					relativePath,
					err: cause,
				},
				"An unavailable resource was skipped.",
			);
		}
	}
}
