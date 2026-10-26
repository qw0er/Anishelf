import type {
	AiringEpisode,
	ArtworkAsset,
	ArtworkStatus,
	CachedMetadata,
	MetadataFailure,
	MetadataSnapshot,
	Page,
	ProviderCapabilities,
	ProviderReference,
	ReadOptions,
	SearchRequest,
	WorkDetails,
	WorkRelation,
	WorkSummary,
} from "./domain/source-model.js";
export interface ProviderResult<T> {
	data: T;
}
export interface MetadataProvider {
	readonly capabilities: ProviderCapabilities;
	resolveReference?(value: string): ProviderReference | null;
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
	identify(reference: ProviderReference): string;
	originalIdentity(reference: ProviderReference): string;
	identity(id: string): string | null;
	references(id: string): ProviderReference[];
	merge(target: string, other: string): void;
	current(key: string): CacheEntry | null;
	find(key: string): CacheEntry | null;
	get(id: string): CacheEntry | null;
	save(entry: CacheEntry): void;
	fail(id: string, failure: MetadataFailure): void;
	touch(id: string, now: number): void;
	retain(id: string, owner: string): void;
	release(id: string, owner: string): void;
	prune(searchLimit: number, snapshotLimit: number): void;
	artworks(): ArtworkRecord[];
	artwork(id: string): ArtworkRecord | null;
	artworkByKey(key: string): ArtworkRecord | null;
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
	/** Newest usable artwork for a key without contacting the provider. */
	cached(key: string): Promise<string | null>;
	close(): Promise<void>;
}

export interface SourceMetadataApi {
	artworkEvidence(
		data: WorkDetails,
		kind: "cover" | "banner",
		options?: ReadOptions,
	): Promise<ArtworkStatus>;
	close(): Promise<void>;
	providers(): ProviderCapabilities[];
	resolveReference(value: string, provider?: string): ProviderReference;
	search(
		request: SearchRequest,
		options?: ReadOptions,
	): Promise<CachedMetadata<Page<WorkSummary>>>;
	get(
		reference: ProviderReference,
		options?: ReadOptions,
	): Promise<CachedMetadata<WorkDetails>>;
	relations(
		reference: ProviderReference,
		page?: number,
		perPage?: number,
		options?: ReadOptions,
	): Promise<CachedMetadata<Page<WorkRelation>>>;
	airing(
		reference: ProviderReference,
		page?: number,
		perPage?: number,
		options?: ReadOptions,
	): Promise<CachedMetadata<Page<AiringEpisode>>>;
	snapshot(snapshotId: string): MetadataSnapshot;
	current(reference: ProviderReference): CachedMetadata<WorkDetails> | null;
	/** Catalog owns owner IDs; idempotent pins preserve referenced snapshot versions. */
	retain(snapshotId: string, ownerId: string): void;
	release(snapshotId: string, ownerId: string): void;
	artwork(
		reference: ProviderReference,
		kind: "cover" | "banner",
		options?: ReadOptions,
	): Promise<ArtworkStatus>;
	/** Load artwork from a retained snapshot without querying the provider. */
	snapshotArtwork(
		snapshotId: string,
		kind: "cover" | "banner",
	): Promise<ArtworkStatus>;
	readArtwork(id: string): Promise<ArtworkAsset>;
	/** Cached artwork identity for a provider reference, without contacting the provider. */
	cachedArtworkId(
		reference: ProviderReference,
		kind: "cover" | "banner",
	): Promise<string | null>;
}
