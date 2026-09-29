export type ResourceId = string;
/** ISO 8601 UTC timestamp serialized as a string. */
export type Timestamp = string;

export interface DirectoryEntry {
	kind: "directory";
	id: ResourceId;
	parentId: ResourceId | null;
	name: string;
	relativePath: string;
}

export interface FileEntry {
	kind: "file";
	id: ResourceId;
	parentId: ResourceId;
	name: string;
	relativePath: string;
	sizeBytes: number;
	modifiedAt: Timestamp;
	mimeType: string;
}

export type LibraryEntry = DirectoryEntry | FileEntry;

/** Published snapshots are read-only; traversal builds a separate candidate. */
export interface LibrarySnapshot {
	revision: number;
	scannedAt: Timestamp | null;
	rootId: "root";
	entriesById: ReadonlyMap<ResourceId, LibraryEntry>;
	childIdsByParent: ReadonlyMap<ResourceId, readonly ResourceId[]>;
}

export interface ScanWarningSummary {
	count: number;
	/** Bounded, user-safe summary; detailed paths belong in local logs. */
	messages: readonly string[];
}

interface ScanProgress {
	id: string;
	startedAt: Timestamp;
	visitedCount: number;
	matchedCount: number;
	warnings: ScanWarningSummary;
}

export type ScanState =
	| (ScanProgress & { status: "running"; finishedAt: null })
	| (ScanProgress & { status: "completed"; finishedAt: Timestamp })
	| (ScanProgress & {
			status: "failed";
			finishedAt: Timestamp;
			error: LibraryIssue;
	  })
	| (ScanProgress & { status: "cancelled"; finishedAt: Timestamp });

export interface LibraryIssue {
	code:
		| "RESOURCE_ROOT_NOT_CONFIGURED"
		| "RESOURCE_ROOT_UNAVAILABLE"
		| "SCAN_FAILED";
	message: string;
}
