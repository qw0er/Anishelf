import type {
	AiringEpisode,
	ArtworkAsset,
	ArtworkStatus,
	CachedMetadata,
	MetadataSnapshot,
	Page,
	ProviderCapabilities,
	ProviderReference,
	ReadOptions,
	SearchRequest,
	WorkDetails,
	WorkRelation,
	WorkSummary,
} from "./domain/model.js";

export type { ProviderReference } from "./domain/model.js";
export {
	airedEpisodeCount,
	MetadataError,
	workTitle,
} from "./domain/model.js";
export interface MetadataApi {
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

export type {
	CachedMetadata,
	MetadataFailure,
	WorkDetails,
} from "./domain/model.js";
