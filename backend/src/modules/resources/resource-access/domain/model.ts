export interface FileInfo {
	kind: "file";
	id: string;
	parentId: string;
	name: string;
	sizeBytes: number;
	modifiedAt: string;
	mimeType: string;
}

/** Identifies one file version within an opaque Resources scope. Backend only. */
export interface FileSourceIdentity {
	scopeId: string;
	relativePath: string;
	sourceVersion: string;
}

export interface SourceIdentity extends FileSourceIdentity {
	fileId: string;
}

/** Durable identities omit the process-local access revision; active operations retain it. */
export interface SourceReference {
	identity: SourceIdentity;
	accessRevision?: number;
}

export interface ResolvedSource {
	identity: SourceIdentity;
	file: FileInfo;
	accessRevision: number;
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

/** Opaque membership selected by Resources; paths stay private. */
export interface ResourceScope {
	readonly ids: readonly string[];
	readonly revision: number;
}
