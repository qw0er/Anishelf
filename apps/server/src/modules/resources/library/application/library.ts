import { isAbsolute, posix, relative, resolve } from "node:path";
import { DomainError } from "../../../../shared/errors.js";
import type { DeepReadonly } from "../../../../shared/policy.js";
import type {
	ResourceAccessApi,
	ResourceRootsApi,
} from "../../resource-access/public.js";
import type {
	DirectoryInfo,
	DirectoryListing,
	FileEntry,
	FileInfo,
	LibraryChange,
	LibraryEntry,
	LibraryStatus,
	ResourceInfo,
} from "../domain/model.js";
import { createResourceId } from "../domain/model.js";
import type { LibraryIndex } from "../infrastructure/index.js";
import type { LibraryRuntimePolicy } from "../policy.js";
import type { LibraryApi } from "../public.js";
import type { LibrarySynchronizer } from "./library-synchronizer.js";
import type { ResourceCommands } from "./mutations.js";
import type { ResourceSettingsApplication } from "./settings.js";

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
		...(entry.sourceVersion ? { sourceVersion: entry.sourceVersion } : {}),
	};
}

export class LibraryApplication<
	TPolicy extends LibraryRuntimePolicy = LibraryRuntimePolicy,
> implements LibraryApi
{
	readonly policy: DeepReadonly<TPolicy>;
	readonly sources: ResourceAccessApi;
	readonly settings: ResourceSettingsApplication;
	readonly commands: ResourceCommands;
	private readonly synchronizer: LibrarySynchronizer;
	constructor(
		private readonly options: {
			roots: ResourceRootsApi;
			index: LibraryIndex;
			policy: DeepReadonly<TPolicy>;
			sources: ResourceAccessApi;
			synchronizer: LibrarySynchronizer;
			settings: ResourceSettingsApplication;
			commands: ResourceCommands;
		},
	) {
		this.policy = options.policy;
		this.sources = options.sources;
		this.synchronizer = options.synchronizer;
		this.settings = options.settings;
		this.commands = options.commands;
	}
	get state() {
		return this.synchronizer.state;
	}
	getSettings() {
		return this.settings.getSettings();
	}
	async downloadRoots() {
		return (await this.options.roots.list(this.getSettings())).map(
			({ scopeId, name, path }) => ({ scopeId, name, path }),
		);
	}
	async validateDownloadRoot(scopeId: string, incompletePath: string) {
		const root = await this.options.roots.resolve(this.getSettings(), scopeId);
		await this.options.roots.open(root);
		for (const watched of await this.options.roots.list(this.getSettings())) {
			const path = relative(resolve(watched.path), resolve(incompletePath));
			if (
				!path ||
				(!path.startsWith(`..${posix.sep}`) &&
					path !== ".." &&
					!isAbsolute(path))
			)
				throw new DomainError(
					"INVALID_REQUEST",
					"Incomplete downloads must be outside watched roots.",
				);
		}
	}
	private async downloadAccess(scopeId: string, path: string) {
		if (
			!path ||
			path.length > 4096 ||
			path.includes("\\") ||
			path.includes("\0") ||
			posix.isAbsolute(path) ||
			path.split("/").some((part) => !part || part === "." || part === "..")
		)
			throw new DomainError("INVALID_REQUEST", "Invalid download file path.");
		const epoch = this.sources.accessRevision;
		const root = await this.options.roots.resolve(this.getSettings(), scopeId);
		const resources = await this.options.roots.open(root);
		const file = await resources.inspectVideoFileWithVersion(path);
		this.sources.assertAccessRevision(epoch);
		return { file, epoch };
	}
	async inspectDownload(scopeId: string, path: string) {
		return (await this.downloadAccess(scopeId, path)).file;
	}
	async refreshDownload(scopeId: string, path: string) {
		const before = await this.downloadAccess(scopeId, path);
		await this.synchronizer.refreshPaths(scopeId, [path]);
		this.sources.assertAccessRevision(before.epoch);
		const id = createResourceId("file", path, scopeId);
		return (await this.sources.resolveSource(id, before.file.sourceVersion))
			.identity;
	}
	getFile(id: string) {
		return this.sources.getFile(id);
	}
	openMedia(id: string) {
		return this.sources.openMedia(id);
	}
	startScan() {
		return this.synchronizer.startScan();
	}
	waitForCompletion() {
		return this.synchronizer.waitForCompletion();
	}
	cancelScan() {
		return this.synchronizer.cancelScan();
	}
	close() {
		return this.synchronizer.close();
	}
	async getStatus(): Promise<LibraryStatus> {
		// Capture index and task state together before the asynchronous availability check.
		const settings = this.getSettings();
		const revision = this.options.index.revision;
		const scannedAt = this.options.index.scannedAt;
		const scan = this.state;
		const { roots, issue: rootIssue } =
			await this.options.roots.inspect(settings);
		const error = rootIssue ?? (scan?.status === "failed" ? scan.error : null);
		return {
			monitor: this.synchronizer.monitorState,
			ready: rootIssue === null,
			roots: roots.map((root) => ({
				id: root.scopeId,
				name: root.name,
				available: root.error === null,
				error: root.error,
			})),
			revision,
			scan,
			error,
			stale: scannedAt !== null && error !== null,
		};
	}

	onSnapshotChanged(listener: (change: LibraryChange) => void): () => void {
		return this.synchronizer.onSnapshotChanged(listener);
	}
	readDirectoryFiles(id: string): FileInfo[] {
		try {
			return this.options.index
				.listChildren(id)
				.filter((entry): entry is FileEntry => entry.kind === "file")
				.map(fileInfo);
		} catch (error) {
			if (error instanceof DomainError && error.code === "RESOURCE_NOT_FOUND")
				return [];
			throw error;
		}
	}
	readFilePage(
		revision: number,
		offset: number,
		limit: number,
	): { files: FileInfo[]; nextOffset: number | null } {
		const page = this.options.index.readFilePage(revision, offset, limit);
		return { files: page.files.map(fileInfo), nextOffset: page.nextOffset };
	}

	getDirectory(id: string): DirectoryListing {
		return {
			directory: directoryInfo(this.options.index.getDirectory(id)),
			children: this.options.index.listChildren(id).map(resourceInfo),
		};
	}
	searchDirectory(id: string, query: string) {
		return this.options.index
			.searchDescendants(id, query)
			.map(({ entry, parentPath }) => ({
				resource: resourceInfo(entry),
				parentPath,
			}));
	}
}
