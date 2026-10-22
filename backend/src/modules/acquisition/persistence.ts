import type { Store } from "../../platform/database/store.js";
import { DiscoveryRepository } from "./discovery/infrastructure/repository.js";

export {
	acquisitionCandidates,
	acquisitionSubscriptions,
} from "./discovery/infrastructure/schema.js";

import type { DiscoveryStore } from "./discovery/ports.js";
import {
	type FeedRecord,
	SourceRepository,
	type SourceStore,
} from "./sources/persistence.js";

/** Shared-connection facade keeps subscription confirmation atomic. */
export type AcquisitionStore = DiscoveryStore & SourceStore;
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
class AcquisitionRepository extends DiscoveryRepository implements SourceStore {
	private readonly sources: SourceRepository;
	constructor(store: Store) {
		super(store);
		this.sources = new SourceRepository(store);
	}
	feed(id: string) {
		return this.sources.feed(id);
	}
	saveFeed(feed: FeedRecord) {
		this.sources.saveFeed(feed);
	}
}
