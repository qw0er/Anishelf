import type {
	AiringEpisode,
	MetadataFailure,
	WorkDetails,
	WorkRelation,
	WorkSummary,
} from "../domain/model.js";
export interface NormalizedSnapshot {
	id: string;
	key: string;
	kind: "search" | "detail" | "relations" | "airing";
	fetchedAt: number;
	expiresAt: number;
	accessedAt: number;
	failure: MetadataFailure | null;
	page: number | null;
	perPage: number | null;
	hasNextPage: boolean | null;
	detail: WorkDetails | null;
	items: WorkSummary[];
	relations: WorkRelation[];
	airing: AiringEpisode[];
}
