import { DomainError } from "../../../../shared/errors.js";
import type { PersistentSettings } from "../../../system/public.js";
import type {
	FileInfo,
	ResolvedSource,
	ResourceScope,
	SourceCatalog,
	SourceReference,
} from "../domain/model.js";
import { assertFileSource, assertSourceVersion } from "../domain/validation.js";
import type {
	OpenedResourceFile,
	ResourceRootAccess,
	ResourceRootsApi,
} from "../ports.js";
import type { ResourceAccessApi } from "../public.js";

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
/** Owns resource membership, source validity and access invalidation. */
export class ResourceAccessApplication implements ResourceAccessApi {
	private revision = 0;
	constructor(
		private readonly options: {
			catalog: SourceCatalog;
			configuration: { readonly settings: Readonly<PersistentSettings> };
			roots: ResourceRootsApi;
		},
	) {}
	private getSettings() {
		return { ...this.options.configuration.settings };
	}
	invalidateRoot(): void {
		this.revision += 1;
	}
	assertAccessRevision(epoch: number): void {
		if (epoch !== this.revision)
			throw new DomainError("PLAYBACK_CONFLICT", "The resource root changed.");
	}

	private async withRoot<T>(
		operation: () => Promise<T>,
		epoch = this.revision,
	): Promise<T> {
		this.assertAccessRevision(epoch);
		let result: T;
		try {
			result = await operation();
		} catch (error) {
			// Prefer a root conflict over a misleading missing-file/access error after a switch.
			this.assertAccessRevision(epoch);
			throw error;
		}
		this.assertAccessRevision(epoch);
		return result;
	}

	private async openConfigured(
		settings: Readonly<PersistentSettings>,
		scopeId?: string,
	): Promise<ResourceRootAccess> {
		return this.options.roots.open(
			await this.options.roots.resolve(settings, scopeId),
		);
	}
	async openResources(expected?: SourceReference): Promise<ResourceRootAccess> {
		return this.withRoot(
			() => this.openConfigured(this.getSettings(), expected?.identity.scopeId),
			expected?.accessRevision,
		);
	}
	async getFile(id: string): Promise<FileInfo> {
		const entry = this.options.catalog.getFile(id);
		const settings = this.getSettings();
		const resources = await this.openConfigured(settings, entry.scopeId);
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

	get accessRevision(): number {
		return this.revision;
	}
	get hasSnapshot(): boolean {
		return this.options.catalog.hasSnapshot;
	}

	async getScope(): Promise<ResourceScope> {
		return this.withRoot(async () => ({
			ids: (await this.options.roots.list(this.getSettings())).map(
				(root) => root.scopeId,
			),
			revision: this.revision,
		}));
	}
	async filePath(expected: SourceReference): Promise<string> {
		const current = await this.revalidateSource(expected);
		return this.withRoot(async () => {
			const resources = await this.openResources(current);
			return resources.filePath(current.identity.relativePath);
		}, current.accessRevision);
	}

	async resolveSource(
		id: string,
		expectedVersion?: string,
	): Promise<ResolvedSource> {
		const epoch = this.revision;
		return this.withRoot(async () => {
			const entry = this.options.catalog.getFile(id);
			const resources = await this.openConfigured(
				this.getSettings(),
				entry.scopeId,
			);
			const metadata = await resources.inspectVideoFileWithVersion(
				entry.relativePath,
			);
			if (expectedVersion !== undefined)
				assertSourceVersion(expectedVersion, metadata.sourceVersion);
			return {
				identity: {
					scopeId: resources.scopeId,
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
				accessRevision: epoch,
			};
		}, epoch);
	}

	async revalidateSource(expected: SourceReference): Promise<ResolvedSource> {
		return this.withRoot(async () => {
			const current = await this.resolveSource(expected.identity.fileId);
			assertFileSource(expected.identity, current.identity);
			return current;
		}, expected.accessRevision);
	}

	async openMedia(id: string): Promise<OpenedResourceFile> {
		// Pair the entry with its root before yielding, even if a settings save follows.
		const entry = this.options.catalog.getFile(id);
		const settings = this.getSettings();
		const resources = await this.openConfigured(settings, entry.scopeId);
		return resources.openFile(entry.relativePath);
	}
}
