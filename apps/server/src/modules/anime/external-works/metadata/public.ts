import type { ExternalWorkReference } from "../../../../shared/external-reference.js";
import type {
	AiringEpisode,
	ArtworkAsset,
	ArtworkStatus,
	CachedMetadata,
	MetadataSnapshot,
	MetadataTitle,
	Page,
	ReadOptions,
	SearchRequest,
	TitleDisplayPreference,
	WorkDetails,
	WorkReference,
	WorkRelation,
	WorkSummary,
} from "./domain/model.js";
import type { MetadataIdentitiesApi } from "./identities.js";

export type {
	MetadataTitle,
	TitleDisplayPreference,
	WorkReference,
} from "./domain/model.js";
export {
	airedEpisodeCount,
	MetadataError,
	workTitle,
} from "./domain/model.js";
export interface MetadataApi {
	providers(): {
		key: string;
		name: string;
		metadata: true;
		tracking: boolean;
	}[];
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

/** Presentation capability: reads cached evidence and schedules only the requested page. */
export interface MetadataLibraryTitlesApi {
	cached(
		references: readonly ExternalWorkReference[],
	): ReadonlyMap<string, readonly MetadataTitle[]>;
	request(
		references: readonly ExternalWorkReference[],
		preference: TitleDisplayPreference,
	): boolean;
}

/** Assembly result; ordinary consumers depend on MetadataApi or narrower ports. */
export interface MetadataModule extends MetadataApi {
	readonly identities: MetadataIdentitiesApi;
	readonly libraryTitles: MetadataLibraryTitlesApi;
	close(): Promise<void>;
}

export type {
	CachedMetadata,
	MetadataFailure,
	WorkDetails,
} from "./domain/model.js";
/** Explicit external integration boundary, separate from MetadataApi content reads. */
export type { MetadataIdentitiesApi } from "./identities.js";
