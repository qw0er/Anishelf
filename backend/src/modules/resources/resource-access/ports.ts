import type { Dirent } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import type { PersistentSettings } from "../../system/public.js";
import type {
	FileInfo,
	FileSourceIdentity,
	RegisteredSource,
	ResolvedSource,
	ResourceScope,
	RootIssue,
	SourceIdentity,
	SourceReference,
} from "./domain/model.js";
export interface ResourceFileMetadata {
	sizeBytes: number;
	modifiedAt: string;
	mimeType: string;
}

export interface ResourceSourceMetadata extends ResourceFileMetadata {
	sourceVersion: string;
}

export interface OpenedResourceFile extends ResourceFileMetadata {
	/** The caller owns the resource and must release it after use. */
	handle: FileHandle;
	release(): Promise<void>;
}

/** Confined filesystem capability; implementations retain handle ownership rules. */
export interface ResourceFiles {
	readonly scopeId: string;
	readDirectory(relativePath?: string): Promise<Dirent[]>;
	inspectVideoFile(relativePath: string): Promise<ResourceFileMetadata>;
	inspectVideoFileWithVersion(
		relativePath: string,
	): Promise<ResourceSourceMetadata>;
	inspectSubtitleSource(relativePath: string): Promise<ResourceSourceMetadata>;
	openFile(relativePath: string): Promise<OpenedResourceFile>;
	openSubtitleFile(relativePath: string): Promise<OpenedResourceFile>;
	openSubtitleSource(expected: FileSourceIdentity): Promise<OpenedResourceFile>;
	revalidateSubtitleSource(expected: FileSourceIdentity): Promise<void>;
}
export interface ResourceAccessApi {
	readonly accessRevision: number;
	readonly hasSnapshot: boolean;
	resolveSource(id: string, expectedVersion?: string): Promise<ResolvedSource>;
	revalidateSource(expected: SourceReference): Promise<ResolvedSource>;
	assertAccessRevision(epoch: number): void;
	getScope(): Promise<ResourceScope>;
	filePath(expected: SourceReference): Promise<string>;
	getFile(id: string): Promise<FileInfo>;
	openMedia(id: string): Promise<OpenedResourceFile>;
	openResources(expected?: SourceReference): Promise<ResourceFiles>;
}
export interface SourceRegistry {
	registerSource(identity: SourceIdentity, nowMs?: number): RegisteredSource;
}

/** Private directory descriptors stay inside Resources; consumers receive opaque scopes. */
export interface ResourceRoot {
	readonly scopeId: string;
	readonly path: string;
	readonly name: string;
}
export interface ResourceRootStatus extends ResourceRoot {
	readonly error: RootIssue | null;
}
export interface ResourceRootSelection {
	roots: ResourceRootStatus[];
	issue: RootIssue | null;
}
export interface ResourceRootAccess extends ResourceFiles {
	filePath(relativePath: string): Promise<string>;
}
export interface ResourceRootsApi {
	list(settings: Readonly<PersistentSettings>): Promise<ResourceRoot[]>;
	inspect(
		settings: Readonly<PersistentSettings>,
	): Promise<ResourceRootSelection>;
	open(root: ResourceRoot): Promise<ResourceRootAccess>;
	resolve(
		settings: Readonly<PersistentSettings>,
		scopeId?: string,
	): Promise<ResourceRoot>;
}
