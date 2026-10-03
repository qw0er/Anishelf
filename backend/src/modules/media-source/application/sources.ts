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
	SourceReference,
} from "../domain/model.js";
import { assertFileSource, assertSourceVersion } from "../domain/validation.js";
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
	assertRootEpoch(epoch: number): void {
		if (epoch !== this.rootEpoch)
			throw new DomainError("PLAYBACK_CONFLICT", "The resource root changed.");
	}

	private async withRoot<T>(
		operation: () => Promise<T>,
		epoch = this.rootEpoch,
	): Promise<T> {
		this.assertRootEpoch(epoch);
		let result: T;
		try {
			result = await operation();
		} catch (error) {
			// Prefer a root conflict over a misleading missing-file/access error after a switch.
			this.assertRootEpoch(epoch);
			throw error;
		}
		this.assertRootEpoch(epoch);
		return result;
	}

	async openResources(expected?: SourceReference): Promise<ResourceAccess> {
		return this.withRoot(async () => {
			const resources = await ResourceAccess.create(
				this.getSettings(),
				this.policy,
			);
			if (
				expected &&
				resources.canonicalRoot !== expected.identity.canonicalRoot
			)
				throw new DomainError(
					"PLAYBACK_CONFLICT",
					"The resource root changed.",
				);
			return resources;
		}, expected?.rootEpoch);
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
		return (await this.openResources()).canonicalRoot;
	}

	async resolveSource(
		id: string,
		expectedVersion?: string,
	): Promise<ResolvedSource> {
		const epoch = this.rootEpoch;
		return this.withRoot(async () => {
			const entry = this.options.catalog.getFile(id);
			const resources = await this.openResources();
			const metadata = await resources.inspectVideoFileWithVersion(
				entry.relativePath,
			);
			if (expectedVersion !== undefined)
				assertSourceVersion(expectedVersion, metadata.sourceVersion);
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
		}, epoch);
	}

	async revalidateSource(expected: SourceReference): Promise<ResolvedSource> {
		return this.withRoot(async () => {
			const current = await this.resolveSource(expected.identity.fileId);
			assertFileSource(expected.identity, current.identity);
			return current;
		}, expected.rootEpoch);
	}

	async openMedia(id: string): Promise<OpenedResourceFile> {
		// Pair the entry with its root before yielding, even if a settings save follows.
		const entry = this.options.catalog.getFile(id);
		const settings = this.getSettings();
		const resources = await ResourceAccess.create(settings, this.policy);
		return resources.openFile(entry.relativePath);
	}
}
