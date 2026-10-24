import type {
	CatalogQuery,
	LocalWork,
	WorkCard,
} from "../../anime-catalog/public.js";
import type {
	TrackingListSnapshot,
	ViewingStatus,
} from "../../tracking/public.js";
export interface AnimeLibraryQuery extends Omit<CatalogQuery, "sort"> {
	sort?: "title" | "recent" | "updated" | "unwatched";
	scope?: "local" | "all";
	viewingStatus?: ViewingStatus | "untracked";
}
interface LibraryPlaybackTarget {
	episodeId: string;
	episodeNumber: string;
	versionCount: number;
	fileId: string | null;
	sourceVersion: string | null;
}
export interface LibraryCard {
	viewingAvailability: "unknown" | "unmapped" | "tracked" | "untracked";
	availableUnwatchedEpisodes?: number | null;
	nextPlayback: LibraryPlaybackTarget | null;
	id: string;
	localWorkId: string | null;
	reference: WorkCard["reference"];
	displayTitle: string;
	format: string | null;
	year: number | null;
	episodeCount: number | null;
	airedEpisodeCount: number | null;
	updatedAt: number;
	availableEpisodes: number;
	availableRegularEpisodes: number;
	metadataStale: boolean;
	hasCover: boolean;
	/** Provider artwork URL digest used to pin the poster URL. */
	coverVersion: string | null;
	remoteCoverUrl: string | null;
	viewing: {
		status: ViewingStatus;
		progress: number;
		updatedAt: number | null;
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
