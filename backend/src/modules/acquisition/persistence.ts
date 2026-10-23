import type { Store } from "../../platform/database/store.js";
import { DiscoveryRepository } from "./discovery/infrastructure/repository.js";

export {
	acquisitionCandidates,
	acquisitionSubscriptions,
} from "./discovery/infrastructure/schema.js";

import type { DiscoveryStore } from "./discovery/ports.js";
import {
	type FeedRecord,
	type ManagedSource,
	type SourceDownload,
	type SourceLifecycleStore,
	SourceRepository,
	type SourceStore,
} from "./sources/persistence.js";

/** Shared-connection facade keeps subscription confirmation atomic. */
export type AcquisitionStore = DiscoveryStore &
	SourceStore &
	SourceLifecycleStore;
export function createAcquisitionPersistence(store: Store) {
	return new AcquisitionRepository(store);
}

export * from "./downloads/infrastructure/schema.js";
export type { DownloadStore } from "./downloads/public.js";

import { DownloadRepository } from "./downloads/infrastructure/repository.js";
export function createDownloadPersistence(store: Store) {
	return new DownloadRepository(store);
}

export * from "./discovery/infrastructure/schema.js";

export * from "./downloads/infrastructure/schema.js";

export * from "./sources/persistence.js";

/** Source and Discovery repositories participate in the same admission transaction. */
class AcquisitionRepository
	extends DiscoveryRepository
	implements SourceStore, SourceLifecycleStore
{
	private readonly sourceRepository: SourceRepository;
	constructor(store: Store) {
		super(store);
		this.sourceRepository = new SourceRepository(store);
	}
	download(id: string) {
		return this.sourceRepository.download(id);
	}
	saveDownload(value: SourceDownload) {
		this.sourceRepository.saveDownload(value);
	}
	source(id: string) {
		return this.sourceRepository.source(id);
	}
	sources() {
		return this.sourceRepository.sources();
	}
	saveSource(source: ManagedSource) {
		this.sourceRepository.saveSource(source);
	}
	removeSource(id: string) {
		this.sourceRepository.removeSource(id);
	}
	feed(id: string) {
		return this.sourceRepository.feed(id);
	}
	saveFeed(feed: FeedRecord) {
		this.sourceRepository.saveFeed(feed);
	}
}
