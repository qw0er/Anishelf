/** Validated AniList protocol data; no Metadata or Tracking business ownership. */
export interface AniListAccount {
	id: number;
	name: string;
}
interface AniListDate {
	year: number | null;
	month: number | null;
	day: number | null;
}
export interface AniListMediaSummary {
	id: number;
	type: "ANIME" | "MANGA";
	title: {
		romaji: string | null;
		english: string | null;
		native: string | null;
	};
	synonyms: string[] | null;
	startDate: AniListDate | null;
	seasonYear: number | null;
	format: string | null;
	status: string | null;
	episodes: number | null;
	season: string | null;
	coverImage: { extraLarge: string | null; large: string | null } | null;
}
export interface AniListMediaDetails extends AniListMediaSummary {
	description: string | null;
	bannerImage: string | null;
	endDate: AniListDate | null;
	duration: number | null;
	countryOfOrigin: string | null;
	source: string | null;
	genres: string[] | null;
	tags:
		| {
				name: string;
				rank: number | null;
				isGeneralSpoiler: boolean;
				isMediaSpoiler: boolean;
		  }[]
		| null;
	studios: { nodes: { id: number; name: string }[] } | null;
	averageScore: number | null;
	siteUrl: string | null;
	updatedAt: number | null;
	streamingEpisodes:
		| {
				title: string | null;
				url: string | null;
				site: string | null;
				thumbnail: string | null;
		  }[]
		| null;
}
export interface AniListRelation {
	relationType: string;
	node: AniListMediaSummary;
}
export interface AniListAiringEpisode {
	id: number;
	episode: number;
	airingAt: number;
}
export interface AniListPage<T> {
	items: T[];
	page: number;
	perPage: number;
	hasNextPage: boolean;
}
export interface AniListResult<T> {
	data: T;
}
type AniListViewingStatus =
	| "CURRENT"
	| "PLANNING"
	| "COMPLETED"
	| "PAUSED"
	| "DROPPED"
	| "REPEATING";
export interface AniListListEntry {
	id: number;
	mediaId: number;
	progress: number;
	status: AniListViewingStatus;
	updatedAt: number;
	titles: string[];
	format: string | null;
	year: number | null;
	episodeCount: number | null;
	coverUrl: string | null;
}
export interface AniListAccountApi {
	viewer(token: string, signal: AbortSignal): Promise<AniListAccount>;
}
export interface AniListListsApi {
	read(
		accountId: number,
		token: string,
		signal: AbortSignal,
	): Promise<AniListListEntry[]>;
}
export interface AniListMetadataApi {
	search(
		query: string,
		page: number,
		perPage: number,
		signal: AbortSignal,
	): Promise<AniListResult<AniListPage<AniListMediaSummary>>>;
	get(
		id: number,
		signal: AbortSignal,
	): Promise<AniListResult<AniListMediaDetails>>;
	relations(
		id: number,
		signal: AbortSignal,
	): Promise<AniListResult<AniListRelation[]>>;
	airing(
		id: number,
		page: number,
		perPage: number,
		signal: AbortSignal,
	): Promise<AniListResult<AniListPage<AniListAiringEpisode>>>;
}

export interface AniListRemoteState {
	id: number;
	progress: number;
	status: AniListViewingStatus;
	updatedAt: number;
}
export interface AniListDesiredState {
	progress?: number;
	status?: AniListViewingStatus;
}
export interface AniListUpdateApi {
	get(
		accountId: number,
		mediaId: number,
		token: string,
		signal: AbortSignal,
	): Promise<AniListRemoteState | null>;
	save(
		accountId: number,
		mediaId: number,
		entryId: number | null,
		desired: AniListDesiredState,
		token: string,
		signal: AbortSignal,
	): Promise<AniListRemoteState>;
}
