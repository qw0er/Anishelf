export { MetadataError } from "./metadata/public.js";

import type { AnimeCatalogApi } from "./anime-catalog/public.js";
import type { AnimeLibraryApi } from "./anime-library/public.js";
import type { MetadataApi } from "./metadata/public.js";
import type { TrackingApi } from "./tracking/public.js";

export type {
	AcquisitionTarget,
	ReleaseAssessmentApi,
} from "./release-assessment/public.js";

import type { ReleaseAssessmentApi } from "./release-assessment/public.js";
export interface AnimeApi {
	readonly acquisition?: ReleaseAssessmentApi;
	readonly library?: AnimeLibraryApi | undefined;
	readonly tracking?: TrackingApi | undefined;
	readonly metadata:
		| Pick<MetadataApi, "search" | "get" | "relations" | "airing" | "snapshot">
		| undefined;
	readonly catalog:
		| Pick<
				AnimeCatalogApi,
				| "list"
				| "getLocalWorkDetail"
				| "source"
				| "reviews"
				| "fileReviews"
				| "review"
				| "preview"
				| "confirm"
				| "reject"
				| "remove"
				| "editEpisode"
				| "refresh"
		  >
		| undefined;
}
