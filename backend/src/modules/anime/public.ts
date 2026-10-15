export { MetadataError } from "./metadata/public.js";

import type { AnimeCatalogApi } from "./anime-catalog/public.js";
import type { MetadataApi } from "./metadata/public.js";
import type { TrackingApi } from "./tracking/public.js";
export interface AnimeApi {
	readonly tracking?: TrackingApi | undefined;
	readonly metadata:
		| Pick<MetadataApi, "search" | "get" | "relations" | "airing" | "snapshot">
		| undefined;
	readonly catalog:
		| Pick<
				AnimeCatalogApi,
				| "list"
				| "detail"
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
