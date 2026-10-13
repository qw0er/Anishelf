export { MetadataError } from "./metadata/public.js";

import type { AnimeCatalogApi } from "./anime-catalog/public.js";
import type { MetadataApi } from "./metadata/public.js";
export interface AnimeApi {
	readonly metadata:
		| Pick<MetadataApi, "search" | "get" | "relations" | "airing" | "snapshot">
		| undefined;
	readonly catalog:
		| Pick<
				AnimeCatalogApi,
				| "list"
				| "detail"
				| "reviews"
				| "preview"
				| "confirm"
				| "reject"
				| "remove"
				| "editWork"
				| "editEpisode"
				| "refresh"
		  >
		| undefined;
}
