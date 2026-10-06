/** Identifies one file version within a canonical resource root. Backend only. */
export interface FileSourceIdentity {
	canonicalRoot: string;
	relativePath: string;
	sourceVersion: string;
}

export interface SourceIdentity extends FileSourceIdentity {
	fileId: string;
}

/** Durable identities omit the process-local epoch; active operations retain it. */
export interface SourceReference {
	identity: SourceIdentity;
	rootEpoch?: number;
}
