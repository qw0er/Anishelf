export interface FileInfo {
	kind: "file";
	id: string;
	parentId: string;
	name: string;
	sizeBytes: number;
	modifiedAt: string;
	mimeType: string;
}

import type { SourceIdentity } from "../../../shared/media-source.js";

export type {
	FileSourceIdentity,
	SourceIdentity,
	SourceReference,
} from "../../../shared/media-source.js";

export interface ResolvedSource {
	identity: SourceIdentity;
	file: FileInfo;
	rootEpoch: number;
}

export interface RegisteredSource {
	id: string;
	rootId: string;
	fileId: string;
	relativePath: string;
	sourceVersion: string;
	createdAtMs: number;
}

export interface SourceCatalog {
	readonly hasSnapshot: boolean;
	getFile(id: string): FileInfo & { relativePath: string };
}
export interface RootIssue {
	code: "RESOURCE_ROOT_NOT_CONFIGURED" | "RESOURCE_ROOT_UNAVAILABLE";
	message: string;
}
