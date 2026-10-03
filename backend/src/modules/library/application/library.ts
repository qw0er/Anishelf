import type {
	BuiltinPolicy,
	DeepReadonly,
	SettingsStore,
} from "../../configuration/public.js";
import {
	checkResourceRoot,
	type ResourceAccessApi,
} from "../../resource-access/public.js";
import type {
	DirectoryInfo,
	DirectoryListing,
	FileEntry,
	FileInfo,
	LibraryEntry,
	LibraryStatus,
	ResourceInfo,
} from "../domain/model.js";
import type { LibraryIndex } from "../infrastructure/index.js";
import type { ScanCoordinator } from "./scan-coordinator.js";
import type { SettingsApplication } from "./settings.js";

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

export class LibraryApplication {
	readonly policy: DeepReadonly<BuiltinPolicy>;
	readonly sources: ResourceAccessApi;
	readonly settings: SettingsApplication;
	private readonly scans: ScanCoordinator;
	constructor(
		private readonly options: {
			configuration: SettingsStore;
			index: LibraryIndex;
			policy: DeepReadonly<BuiltinPolicy>;
			sources: ResourceAccessApi;
			scans: ScanCoordinator;
			settings: SettingsApplication;
		},
	) {
		this.policy = options.policy;
		this.sources = options.sources;
		this.scans = options.scans;
		this.settings = options.settings;
	}
	get state() {
		return this.scans.state;
	}
	getSettings() {
		return this.settings.getSettings();
	}
	updateSettings(input: Parameters<SettingsApplication["updateSettings"]>[0]) {
		return this.settings.updateSettings(input);
	}
	getFile(id: string) {
		return this.sources.getFile(id);
	}
	openMedia(id: string) {
		return this.sources.openMedia(id);
	}
	startScan() {
		return this.scans.startScan();
	}
	waitForCompletion() {
		return this.scans.waitForCompletion();
	}
	cancelScan() {
		return this.scans.cancelScan();
	}
	close() {
		return this.scans.close();
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
}
