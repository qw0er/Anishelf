export type ProviderReference =
	import("../../../../shared/external-reference.js").ExternalWorkReference;
interface MetadataTitle {
	value: string;
	language: string | null;
	kind: "romaji" | "english" | "native" | "alias";
}
export interface WorkSummary {
	/** Queried provider fields explicitly returned null, including unknown lists. */
	unavailableFields: string[];
	reference: ProviderReference;
	titles: MetadataTitle[];
	year: number | null;
	format: string | null;
	status: string | null;
	episodeCount: number | null;
	/** Calendar season, never a series ordinal. */
	airingSeason: string | null;
	coverUrl: string | null;
}
interface FuzzyDate {
	year: number | null;
	month: number | null;
	day: number | null;
}
export interface WorkDetails extends WorkSummary {
	description: string | null;
	bannerUrl: string | null;
	startDate: FuzzyDate | null;
	endDate: FuzzyDate | null;
	durationMinutes: number | null;
	country: string | null;
	source: string | null;
	genres: string[];
	tags: { name: string; rank: number | null; spoiler: boolean }[];
	studios: { id: string; name: string }[];
	averageScore: number | null;
	siteUrl: string | null;
	providerUpdatedAt: number | null;
	streamingEpisodes: {
		title: string | null;
		url: string | null;
		site: string | null;
		thumbnail: string | null;
	}[];
	/** External links are not a canonical episode catalog. */
	episodeCatalog: "unavailable";
}
export interface Page<T> {
	items: T[];
	page: number;
	perPage: number;
	hasNextPage: boolean;
}
export interface WorkRelation {
	type: string;
	work: WorkSummary;
}
export interface AiringEpisode {
	id: string;
	episode: number;
	airingAt: number;
}
type MetadataFailureCode =
	| "invalid-request"
	| "not-found"
	| "unavailable"
	| "rate-limited"
	| "invalid-response"
	| "busy"
	| "storage-unavailable";
export interface MetadataFailure {
	code: MetadataFailureCode;
	message: string;
	retryAt: number | null;
}
export class MetadataError extends Error {
	constructor(
		readonly failure: MetadataFailure,
		options?: ErrorOptions,
	) {
		super(failure.message, options);
		this.name = "MetadataError";
	}
}
export interface CachedMetadata<T> {
	snapshotId: string;
	fetchedAt: number;
	stale: boolean;
	refreshing: boolean;
	refreshError: MetadataFailure | null;
	data: T;
}
export interface ReadOptions {
	signal?: AbortSignal;
	refresh?: boolean;
	/** Never contact the provider; absent snapshots return not-found. */
	cachedOnly?: boolean;
}
export interface SearchRequest {
	query: string;
	provider?: string;
	page?: number;
	perPage?: number;
}
export interface ProviderCapabilities {
	key: string;
	version: string;
	search: true;
	details: true;
	relations: boolean;
	airing: boolean;
	streamingLinks: boolean;
	canonicalEpisodes: false;
}
export interface ArtworkStatus {
	id: string | null;
	status: "ready" | "missing" | "failed";
	failure: MetadataFailure | null;
}
export interface ArtworkAsset {
	bytes: Uint8Array;
	mimeType: string;
}

export type MetadataSnapshot =
	| ({ kind: "search" } & CachedMetadata<Page<WorkSummary>>)
	| ({ kind: "detail" } & CachedMetadata<WorkDetails>)
	| ({ kind: "relations" } & CachedMetadata<Page<WorkRelation>>)
	| ({ kind: "airing" } & CachedMetadata<Page<AiringEpisode>>);
