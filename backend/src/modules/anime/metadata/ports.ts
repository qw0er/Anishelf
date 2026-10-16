import type {
	AiringEpisode,
	ArtworkAsset,
	ArtworkStatus,
	MetadataFailure,
	Page,
	ProviderCapabilities,
	ProviderReference,
	ReadOptions,
	WorkDetails,
	WorkRelation,
	WorkSummary,
} from "./domain/model.js";
export interface ProviderResult<T> {
	data: T;
	raw: unknown;
}
export interface MetadataProvider {
	readonly capabilities: ProviderCapabilities;
	search(
		query: string,
		page: number,
		perPage: number,
		signal: AbortSignal,
	): Promise<ProviderResult<Page<WorkSummary>>>;
	get(
		reference: ProviderReference,
		signal: AbortSignal,
	): Promise<ProviderResult<WorkDetails>>;
	relations(
		reference: ProviderReference,
		page: number,
		perPage: number,
		signal: AbortSignal,
	): Promise<ProviderResult<Page<WorkRelation>>>;
	airing(
		reference: ProviderReference,
		page: number,
		perPage: number,
		signal: AbortSignal,
	): Promise<ProviderResult<Page<AiringEpisode>>>;
}
export interface CacheEntry {
	id: string;
	key: string;
	kind: "search" | "detail" | "relations" | "airing";
	data: unknown;
	raw: unknown;
	fetchedAt: number;
	expiresAt: number;
	accessedAt: number;
	failure: MetadataFailure | null;
}
export interface ArtworkRecord {
	id: string;
	key: string;
	url: string;
	mimeType: string;
	sizeBytes: number;
	accessedAt: number;
}
export interface MetadataStore {
	find(key: string): CacheEntry | null;
	get(id: string): CacheEntry | null;
	save(entry: CacheEntry): void;
	fail(id: string, failure: MetadataFailure): void;
	touch(id: string, now: number): void;
	retain(id: string, owner: string): void;
	release(id: string, owner: string): void;
	prune(searchLimit: number, snapshotLimit: number): void;
	artworks(): ArtworkRecord[];
	saveArtwork(record: ArtworkRecord): void;
	removeArtwork(id: string): void;
}

export interface MetadataArtwork {
	get(
		key: string,
		url: string | null,
		options: ReadOptions,
	): Promise<ArtworkStatus>;
	read(id: string): Promise<ArtworkAsset>;
	close(): Promise<void>;
}
