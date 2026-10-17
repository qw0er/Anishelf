import { DomainError } from "../../../../shared/errors.js";
import type { DeepReadonly } from "../../../../shared/policy.js";
import type { PersistentSettings } from "../../../system/public.js";
import type {
	FileInfo,
	ResolvedSource,
	ResourceScope,
	SourceCatalog,
	SourceReference,
} from "../domain/model.js";
import { assertFileSource, assertSourceVersion } from "../domain/validation.js";
import { ResourceAccess } from "../infrastructure/access.js";
import type { ResourceAccessRuntimePolicy } from "../policy.js";
import type { OpenedResourceFile } from "../ports.js";
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
			policy: DeepReadonly<ResourceAccessRuntimePolicy>;
		},
	) {}
	get policy() {
		return this.options.policy;
	}
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

	async openResources(expected?: SourceReference): Promise<ResourceAccess> {
		return this.withRoot(async () => {
			const resources = await ResourceAccess.create(
				this.getSettings(),
				this.policy,
			);
			if (expected && resources.scopeId !== expected.identity.scopeId)
				throw new DomainError(
					"PLAYBACK_CONFLICT",
					"The resource root changed.",
				);
			return resources;
		}, expected?.accessRevision);
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

	get accessRevision(): number {
		return this.revision;
	}
	get hasSnapshot(): boolean {
		return this.options.catalog.hasSnapshot;
	}

	async getScope(): Promise<ResourceScope> {
		return this.withRoot(async () => ({
			ids: [(await this.openResources()).scopeId],
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
			const resources = await this.openResources();
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
		const resources = await ResourceAccess.create(settings, this.policy);
		return resources.openFile(entry.relativePath);
	}
}
