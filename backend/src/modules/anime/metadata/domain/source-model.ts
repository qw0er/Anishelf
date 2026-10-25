import type {
	WorkDetails as ProjectDetails,
	WorkSummary as ProjectSummary,
} from "./model.js";

export type {
	ArtworkAsset,
	ArtworkStatus,
	CachedMetadata,
	MetadataFailure,
	Page,
	ReadOptions,
} from "./model.js";
export { MetadataError, workTitle } from "./model.js";

import type { CachedMetadata, Page } from "./model.js";
export type ProviderReference =
	import("../../../../shared/external-reference.js").ExternalWorkReference;

/** Private source evidence; never returned by MetadataApi. */
export interface WorkSummary extends Omit<ProjectSummary, "reference"> {
	reference: ProviderReference;
}
export interface WorkDetails
	extends Omit<ProjectDetails, "reference" | "studios"> {
	reference: ProviderReference;
	studios: { id: string; name: string }[];
	siteUrl: string | null;
	providerUpdatedAt: number | null;
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
export interface SearchRequest {
	query: string;
	provider?: string;
	page?: number;
	perPage?: number;
}
export type MetadataSnapshot =
	| ({ kind: "search" } & CachedMetadata<Page<WorkSummary>>)
	| ({ kind: "detail" } & CachedMetadata<WorkDetails>)
	| ({ kind: "relations" } & CachedMetadata<Page<WorkRelation>>)
	| ({ kind: "airing" } & CachedMetadata<Page<AiringEpisode>>);

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
