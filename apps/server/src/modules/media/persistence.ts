import { InspectionRepository } from "./inspection/infrastructure/repository.js";
import type { InspectionStore } from "./inspection/ports.js";

export { mediaInspections } from "./inspection/infrastructure/schema.js";

import type { Store } from "../../platform/database/store.js";
import type { SourceRegistry } from "../resources/public.js";
import { PreparationRepository } from "./preparation/infrastructure/repository.js";
import type { PreparationStore } from "./preparation/ports.js";

export {
	preparationTasks,
	preparedArtifacts,
} from "./preparation/persistence.js";
export {
	subtitleAssets,
	subtitleFontAssets,
	subtitleFontSets,
} from "./subtitles/persistence.js";
export interface MediaPersistence {
	inspections: InspectionStore;
	preparation: PreparationStore;
}
export function createMediaPersistence(
	store: Store,
	sources: SourceRegistry,
): MediaPersistence {
	return {
		inspections: new InspectionRepository(store),
		preparation: new PreparationRepository(store, sources),
	};
}

export * from "./preparation/infrastructure/schema.js";

export * from "./subtitles/infrastructure/schema.js";
