import { join } from "node:path";
import type { Logger } from "pino";
import { DomainError } from "../../../shared/errors.js";
import type { DeepReadonly } from "../../../shared/policy.js";
import {
	getVideoMimeType,
	type ResourceAccess,
} from "../../resource-access/public.js";
import {
	createResourceId,
	type DirectoryEntry,
	type LibraryEntry,
} from "../domain/model.js";
import {
	type LibraryRuntimePolicy,
	libraryRuntimePolicy,
} from "../domain/policy.js";
import type { ScanWarningSummary } from "../domain/scan-state.js";

export interface ScanTraversalProgress {
	id: string;
	visitedCount: number;
	matchedCount: number;
	warnings: ScanWarningSummary;
}
type ScanTask =
	| { kind: "directory"; entry: DirectoryEntry }
	| { kind: "file"; name: string; relativePath: string; parentId: string };

/** Traverses a fixed resource root. The caller owns task state and publication. */
export class LibraryScanner {
	constructor(
		private readonly logger: Logger,
		private readonly policy: DeepReadonly<LibraryRuntimePolicy> = libraryRuntimePolicy,
	) {}

	async scan(
		resources: ResourceAccess,
		rootName: string,
		progress: ScanTraversalProgress,
		signal: AbortSignal,
		onProgress?: (progress: Readonly<ScanTraversalProgress>) => void,
	): Promise<LibraryEntry[] | null> {
		const root: DirectoryEntry = {
			kind: "directory",
			id: "root",
			parentId: null,
			name: rootName,
			relativePath: "",
		};
		const entries: LibraryEntry[] = [];
		const queue: ScanTask[] = [{ kind: "directory", entry: root }];
		let cursor = 0;
		while (cursor < queue.length && !signal.aborted) {
			const batch = queue.slice(
				cursor,
				cursor + this.policy.library.concurrency,
			);
			cursor += batch.length;
			await Promise.all(
				batch.map((task) =>
					this.visit(task, resources, entries, queue, progress, signal).finally(
						() => onProgress?.(progress),
					),
				),
			);
		}
		if (signal.aborted) return null;
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
		if (signal.aborted) return null;

		return entries;
	}

	private async visit(
		task: ScanTask,
		resources: ResourceAccess,
		entries: LibraryEntry[],
		queue: ScanTask[],
		progress: ScanTraversalProgress,
		signal: AbortSignal,
	): Promise<void> {
		if (signal.aborted) return;
		const relativePath =
			task.kind === "directory" ? task.entry.relativePath : task.relativePath;
		try {
			if (task.kind === "file") {
				const metadata = await resources.inspectVideoFile(relativePath);
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
				} else if (
					child.isFile() &&
					getVideoMimeType(
						child.name,
						this.policy.resourceAccess.videoMimeTypes,
					) !== null
				) {
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
			if (
				messages.length < this.policy.library.warningMessageLimit &&
				!messages.includes(message)
			)
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
