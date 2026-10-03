import { DomainError } from "../../../shared/errors.js";
import type {
	BuiltinPolicy,
	DeepReadonly,
	PersistentSettings,
} from "../../configuration/public.js";
import type {
	FileInfo,
	ResolvedSource,
	SourceCatalog,
} from "../domain/model.js";
import {
	type OpenedResourceFile,
	ResourceAccess,
} from "../infrastructure/access.js";

function fileInfo(entry: FileInfo): FileInfo {
	return {
		kind: entry.kind,
		id: entry.id,
		parentId: entry.parentId,
		name: entry.name,
		sizeBytes: entry.sizeBytes,
		modifiedAt: entry.modifiedAt,
		mimeType: entry.mimeType,
	};
}
/** Owns source identity and the single root epoch, independently of library implementation. */
export class MediaSourceApplication {
	private rootEpoch = 0;
	constructor(
		private readonly options: {
			catalog: SourceCatalog;
			configuration: { readonly settings: Readonly<PersistentSettings> };
			policy: DeepReadonly<BuiltinPolicy>;
		},
	) {}
	get policy() {
		return this.options.policy;
	}
	private getSettings() {
		return { ...this.options.configuration.settings };
	}
	invalidateRoot(): void {
		this.rootEpoch += 1;
	}
	openResources() {
		return ResourceAccess.create(this.getSettings(), this.policy);
	}
	async getFile(id: string): Promise<FileInfo> {
		const entry = this.options.catalog.getFile(id);
		const settings = this.getSettings();
		const resources = await ResourceAccess.create(settings, this.policy);
		const current = await resources.inspectVideoFile(entry.relativePath);
		return {
			kind: "file",
			id: entry.id,
			parentId: entry.parentId,
			name: entry.name,
			sizeBytes: current.sizeBytes,
			modifiedAt: current.modifiedAt,
			mimeType: current.mimeType,
		};
	}

	get resourceRootEpoch(): number {
		return this.rootEpoch;
	}
	get hasSnapshot(): boolean {
		return this.options.catalog.hasSnapshot;
	}

	async resolveRoot(): Promise<string> {
		const epoch = this.rootEpoch;
		const resources = await ResourceAccess.create(
			this.getSettings(),
			this.policy,
		);
		if (epoch !== this.rootEpoch)
			throw new DomainError("PLAYBACK_CONFLICT", "The resource root changed.");
		return resources.canonicalRoot;
	}

	async resolveSource(id: string): Promise<ResolvedSource> {
		const epoch = this.rootEpoch;
		const entry = this.options.catalog.getFile(id);
		const resources = await ResourceAccess.create(
			this.getSettings(),
			this.policy,
		);
		const metadata = await resources.inspectVideoFileWithVersion(
			entry.relativePath,
		);
		if (epoch !== this.rootEpoch)
			throw new DomainError("PLAYBACK_CONFLICT", "The resource root changed.");
		return {
			identity: {
				canonicalRoot: resources.canonicalRoot,
				fileId: entry.id,
				relativePath: entry.relativePath,
				sourceVersion: metadata.sourceVersion,
			},
			file: {
				...fileInfo(entry),
				sizeBytes: metadata.sizeBytes,
				modifiedAt: metadata.modifiedAt,
				mimeType: metadata.mimeType,
			},
			rootEpoch: epoch,
		};
	}

	async openMedia(id: string): Promise<OpenedResourceFile> {
		// Pair the entry with its root before yielding, even if a settings save follows.
		const entry = this.options.catalog.getFile(id);
		const settings = this.getSettings();
		const resources = await ResourceAccess.create(settings, this.policy);
		return resources.openFile(entry.relativePath);
	}
}
