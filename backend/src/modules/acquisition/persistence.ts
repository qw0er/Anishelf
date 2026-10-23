import {
	WatchingRepository,
	type WatchingStore,
} from "./watching/persistence.js";

export * from "./watching/persistence.js";

import type { Store } from "../../platform/database/store.js";
import { SubscriptionRepository } from "./subscriptions/infrastructure/repository.js";

export {
	acquisitionCandidates,
	acquisitionSubscriptions,
} from "./subscriptions/infrastructure/schema.js";

import {
	type FeedRecord,
	type ManagedSource,
	type SourceDownload,
	type SourceLifecycleStore,
	SourceRepository,
	type SourceStore,
} from "./sources/persistence.js";
import type { SubscriptionStore } from "./subscriptions/ports.js";

/** Shared-connection facade keeps subscription saves and refresh publication atomic. */
export type AcquisitionStore = SubscriptionStore &
	SourceStore &
	SourceLifecycleStore & { readonly watching: WatchingStore };
export function createAcquisitionPersistence(store: Store) {
	return new AcquisitionRepository(store);
}

export type { DownloadStore } from "./downloads/public.js";

import { DownloadRepository } from "./downloads/infrastructure/repository.js";
export function createDownloadPersistence(store: Store) {
	return new DownloadRepository(store);
}

export * from "./downloads/infrastructure/schema.js";
export * from "./sources/persistence.js";
export * from "./subscriptions/persistence.js";

/** Source and Subscription repositories participate in the same admission transaction. */
class AcquisitionRepository
	extends SubscriptionRepository
	implements SourceStore, SourceLifecycleStore
{
	readonly watching: WatchingRepository;
	private readonly sourceRepository: SourceRepository;
	constructor(store: Store) {
		super(store);
		this.watching = new WatchingRepository(store);
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
