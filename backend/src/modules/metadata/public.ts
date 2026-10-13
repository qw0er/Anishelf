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
export { MetadataError } from "./domain/model.js";
export interface MetadataApi {
	providers(): ProviderCapabilities[];
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
	/** Catalog owns owner IDs; idempotent pins preserve referenced snapshot versions. */
	retain(snapshotId: string, ownerId: string): void;
	release(snapshotId: string, ownerId: string): void;
	artwork(
		reference: ProviderReference,
		kind: "cover" | "banner",
		options?: ReadOptions,
	): Promise<ArtworkStatus>;
	readArtwork(id: string): Promise<ArtworkAsset>;
}

export type { CachedMetadata, WorkDetails } from "./domain/model.js";
