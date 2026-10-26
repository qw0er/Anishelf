export interface WorkReference {
	id: string;
}
export interface MetadataTitle {
	value: string;
	language: string | null;
	kind: "romaji" | "english" | "native" | "alias";
}
/** One title preference for every work projection; original title evidence stays ordered. */
export function workTitle(
	titles: readonly MetadataTitle[],
	fallback: string,
): string {
	return (
		titles.find((title) => title.kind === "native")?.value ??
		titles[0]?.value ??
		fallback
	);
}

/** Derive aired regular episodes from provider status and the next scheduled episode. */
export function airedEpisodeCount(
	input: Pick<WorkSummary, "status" | "episodeCount" | "nextAiringEpisode">,
	now = Date.now(),
): number | null {
	if (input.status === "NOT_YET_RELEASED") return 0;
	if (input.status === "FINISHED") return input.episodeCount;
	const next = input.nextAiringEpisode;
	if (!next) return null;
	const aired = Math.max(
		0,
		next.episode - (next.airingAt * 1000 > now ? 1 : 0),
	);
	return input.episodeCount === null
		? aired
		: Math.min(aired, input.episodeCount);
}
interface NextAiringEpisode {
	episode: number;
	airingAt: number;
}

export interface WorkSummary {
	/** Unavailable fields, named using the project metadata vocabulary. */
	unavailableFields: string[];
	reference: WorkReference;
	titles: MetadataTitle[];
	year: number | null;
	format: string | null;
	status: string | null;
	episodeCount: number | null;
	nextAiringEpisode: NextAiringEpisode | null;
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
	studios: { name: string }[];
	averageScore: number | null;
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
	/** No associated source supplies this content capability. */
	unavailable?: boolean;
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
	page?: number;
	perPage?: number;
}
export interface ArtworkStatus {
	id: string | null;
	status: "ready" | "missing" | "failed";
	failure: MetadataFailure | null;
}
export interface ArtworkAsset {
	/** Content identity; also the strong HTTP validator. */
	id: string;
	bytes: Uint8Array;
	mimeType: string;
}

export type MetadataSnapshot =
	| ({ kind: "search" } & CachedMetadata<Page<WorkSummary>>)
	| ({ kind: "detail" } & CachedMetadata<WorkDetails>)
	| ({ kind: "relations" } & CachedMetadata<Page<WorkRelation>>)
	| ({ kind: "airing" } & CachedMetadata<Page<AiringEpisode>>);
