import type { Dirent } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import type {
	FileInfo,
	FileSourceIdentity,
	RegisteredSource,
	ResolvedSource,
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
	readonly canonicalRoot: string;
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
	readonly resourceRootEpoch: number;
	readonly hasSnapshot: boolean;
	resolveSource(id: string, expectedVersion?: string): Promise<ResolvedSource>;
	revalidateSource(expected: SourceReference): Promise<ResolvedSource>;
	assertRootEpoch(epoch: number): void;
	resolveRoot(): Promise<string>;
	getFile(id: string): Promise<FileInfo>;
	openMedia(id: string): Promise<OpenedResourceFile>;
	openResources(expected?: SourceReference): Promise<ResourceFiles>;
}
export interface SourceRegistry {
	registerSource(identity: SourceIdentity, nowMs?: number): RegisteredSource;
}
