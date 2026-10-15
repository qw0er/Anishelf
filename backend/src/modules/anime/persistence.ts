import type { Store } from "../../platform/database/store.js";
import type { SourceRegistry } from "../resources/public.js";
import { CatalogRepository } from "./anime-catalog/infrastructure/repository.js";
import type { CatalogStore } from "./anime-catalog/ports.js";
import { MetadataRepository } from "./metadata/infrastructure/repository.js";
import type { MetadataStore } from "./metadata/ports.js";

import { TrackingListRepository } from "./tracking/infrastructure/list-repository.js";
import { TrackingRepository } from "./tracking/infrastructure/repository.js";
import type { TrackingListStore, TrackingStore } from "./tracking/ports.js";

export {
	catalogAssociations,
	catalogEpisodes,
	catalogOperations,
	catalogProviderLinks,
	catalogReviews,
	catalogWorks,
} from "./anime-catalog/persistence.js";
export {
	metadataArtwork,
	metadataPins,
	metadataSnapshots,
} from "./metadata/persistence.js";
export {
	trackingConnection,
	trackingListCache,
} from "./tracking/persistence.js";
export interface AnimePersistence {
	tracking: TrackingStore;
	trackingLists: TrackingListStore;
	catalog: CatalogStore;
	metadata: MetadataStore;
}
export function createAnimePersistence(
	store: Store,
	sources: SourceRegistry,
): AnimePersistence {
	return {
		catalog: new CatalogRepository(store, sources),
		tracking: new TrackingRepository(store),
		trackingLists: new TrackingListRepository(store),
		metadata: new MetadataRepository(store),
	};
}
