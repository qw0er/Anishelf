import type { Store } from "../../platform/database/store.js";
import { DiscoveryRepository } from "./discovery/infrastructure/repository.js";

export {
	acquisitionCandidates,
	acquisitionSubscriptions,
} from "./discovery/infrastructure/schema.js";

import type { DiscoveryStore } from "./discovery/ports.js";
import type { SourceStore } from "./sources/public.js";

/** Shared-connection facade keeps subscription confirmation atomic. */
export type AcquisitionStore = DiscoveryStore & SourceStore;
export function createAcquisitionPersistence(store: Store) {
	return new DiscoveryRepository(store);
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
