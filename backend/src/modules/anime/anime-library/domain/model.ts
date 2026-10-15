import type {
	CatalogQuery,
	LocalWork,
	WorkCard,
} from "../../anime-catalog/public.js";
import type {
	TrackingListSnapshot,
	ViewingStatus,
} from "../../tracking/public.js";
export interface AnimeLibraryQuery extends CatalogQuery {
	scope?: "local" | "all";
	viewingStatus?: ViewingStatus | "untracked";
}
export interface LibraryCard {
	id: string;
	localWorkId: string | null;
	reference: WorkCard["reference"];
	displayTitle: string;
	format: string | null;
	year: number | null;
	episodeCount: number | null;
	updatedAt: number;
	availableEpisodes: number;
	availableRegularEpisodes: number;
	metadataStale: boolean;
	hasCover: boolean;
	remoteCoverUrl: string | null;
	viewing: {
		status: ViewingStatus;
		progress: number;
		updatedAt: number;
	} | null;
}
export interface LibraryResult {
	items: LibraryCard[];
	page: number;
	perPage: number;
	hasNextPage: boolean;
	localState: "available" | "unavailable";
	tracking: Omit<TrackingListSnapshot, "entries">;
}
export type LocalIndex = {
	items: (LocalWork & {
		reference: WorkCard["reference"];
		available: boolean;
	})[];
	epoch: number;
};
