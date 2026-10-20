import type { Store } from "../../platform/database/store.js";
import { DiscoveryRepository } from "./discovery/infrastructure/repository.js";

export {
	acquisitionCandidates,
	acquisitionFeeds,
	acquisitionSubscriptions,
} from "./discovery/infrastructure/schema.js";
export type { DiscoveryStore } from "./discovery/ports.js";
export function createAcquisitionPersistence(store: Store) {
	return new DiscoveryRepository(store);
}
