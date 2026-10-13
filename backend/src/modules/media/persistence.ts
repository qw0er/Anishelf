import type { Store } from "../../platform/database/store.js";
import type { SourceRegistry } from "../resources/public.js";
import { PreparationRepository } from "./preparation/infrastructure/repository.js";
import type { PreparationStore } from "./preparation/ports.js";
import { SubtitleRepository } from "./subtitles/infrastructure/repository.js";
import type { SubtitleStore } from "./subtitles/storage.js";

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
	preparation: PreparationStore;
	subtitles: SubtitleStore;
}
export function createMediaPersistence(
	store: Store,
	sources: SourceRegistry,
): MediaPersistence {
	return {
		preparation: new PreparationRepository(store, sources),
		subtitles: new SubtitleRepository(store, sources),
	};
}
