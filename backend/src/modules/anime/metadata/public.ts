import type {
	AiringEpisode,
	ArtworkAsset,
	ArtworkStatus,
	CachedMetadata,
	MetadataSnapshot,
	Page,
	ReadOptions,
	SearchRequest,
	WorkDetails,
	WorkReference,
	WorkRelation,
	WorkSummary,
} from "./domain/model.js";

export type { WorkReference } from "./domain/model.js";
export {
	airedEpisodeCount,
	MetadataError,
	workTitle,
} from "./domain/model.js";
export interface MetadataApi {
	resolveReference(value: string): WorkReference;
	search(
		request: SearchRequest,
		options?: ReadOptions,
	): Promise<CachedMetadata<Page<WorkSummary>>>;
	get(
		reference: WorkReference,
		options?: ReadOptions,
	): Promise<CachedMetadata<WorkDetails>>;
	relations(
		reference: WorkReference,
		page?: number,
		perPage?: number,
		options?: ReadOptions,
	): Promise<CachedMetadata<Page<WorkRelation>>>;
	airing(
		reference: WorkReference,
		page?: number,
		perPage?: number,
		options?: ReadOptions,
	): Promise<CachedMetadata<Page<AiringEpisode>>>;
	snapshot(snapshotId: string): MetadataSnapshot;
	current(reference: WorkReference): CachedMetadata<WorkDetails> | null;
	/** Catalog owns owner IDs; idempotent pins preserve referenced snapshot versions. */
	retain(snapshotId: string, ownerId: string): void;
	release(snapshotId: string, ownerId: string): void;
	artwork(
		reference: WorkReference,
		kind: "cover" | "banner",
		options?: ReadOptions,
	): Promise<ArtworkStatus>;
	/** Load artwork from a retained snapshot without querying the provider. */
	snapshotArtwork(
		snapshotId: string,
		kind: "cover" | "banner",
	): Promise<ArtworkStatus>;
	readArtwork(id: string): Promise<ArtworkAsset>;
	/** Cached artwork identity for a project work, without a network request. */
	cachedArtworkId(
		reference: WorkReference,
		kind: "cover" | "banner",
	): Promise<string | null>;
}

/** Explicit external integration boundary, separate from MetadataApi content reads. */
export type { MetadataAssociations } from "./associations.js";
export type {
	CachedMetadata,
	MetadataFailure,
	WorkDetails,
} from "./domain/model.js";
