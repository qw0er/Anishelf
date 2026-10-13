import { createHash } from "node:crypto";
import type { LibraryIssue, ScanState, Timestamp } from "./scan-state.js";

export type ResourceId = string;

/** Path-free business information; HTTP owns its public DTO projection. */
export interface DirectoryInfo {
	kind: "directory";
	id: ResourceId;
	parentId: ResourceId | null;
	name: string;
}

export type { FileInfo } from "../../resource-access/public.js";

import type { FileInfo } from "../../resource-access/public.js";

export type ResourceInfo = DirectoryInfo | FileInfo;

export interface DirectoryEntry extends DirectoryInfo {
	relativePath: string;
}

export interface FileEntry extends FileInfo {
	relativePath: string;
}

export type LibraryEntry = DirectoryEntry | FileEntry;

export interface DirectoryListing {
	directory: DirectoryInfo;
	children: readonly ResourceInfo[];
}

export interface LibraryStatus {
	ready: boolean;
	revision: number;
	scan: ScanState | null;
	error: LibraryIssue | null;
	stale: boolean;
}

/** Published snapshots are read-only; traversal builds a separate candidate. */
export interface LibrarySnapshot {
	revision: number;
	scannedAt: Timestamp | null;
	rootId: "root";
	entriesById: ReadonlyMap<ResourceId, LibraryEntry>;
	childIdsByParent: ReadonlyMap<ResourceId, readonly ResourceId[]>;
}

/** Stable lookup key for an unchanged kind and root-relative path. */
export function createResourceId(
	kind: LibraryEntry["kind"],
	relativePath: string,
): ResourceId {
	if (kind === "directory" && relativePath === "") return "root";
	return `${kind}_${createHash("sha256").update(kind).update("\0").update(relativePath).digest("base64url")}`;
}
