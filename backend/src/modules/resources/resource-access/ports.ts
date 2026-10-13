import type { Dirent } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import type { DeepReadonly } from "../../../shared/policy.js";
import type { PersistentSettings } from "../../system/public.js";
import type {
	FileInfo,
	FileSourceIdentity,
	RegisteredSource,
	ResolvedSource,
	RootIssue,
	SourceIdentity,
	SourceReference,
} from "./domain/model.js";
import type { ResourceAccessRuntimePolicy } from "./policy.js";
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

export interface ResourceRootApi {
	checkRoot(settings: Readonly<PersistentSettings>): Promise<RootIssue | null>;
	openRoot(
		settings: Readonly<PersistentSettings>,
		policy: DeepReadonly<ResourceAccessRuntimePolicy>,
	): Promise<ResourceFiles>;
}
