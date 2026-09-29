import { createHash } from "node:crypto";
import type { ResourceId, Timestamp } from "../contracts/library.js";

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

/** Stable lookup key for an unchanged kind and root-relative path. */
export function createResourceId(
	kind: LibraryEntry["kind"],
	relativePath: string,
): ResourceId {
	if (kind === "directory" && relativePath === "") return "root";
	return `${kind}_${createHash("sha256").update(kind).update("\0").update(relativePath).digest("base64url")}`;
}
