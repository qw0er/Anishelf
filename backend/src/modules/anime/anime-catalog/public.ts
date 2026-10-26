import type { IdentificationResult } from "../identification/public.js";
import type { MetadataApi } from "../metadata/public.js";

export type { CatalogMetadata } from "./ports.js";

import type {
	CatalogPreview,
	CatalogQuery,
	Confirmation,
	ConfirmationResult,
	LocalEpisode,
	LocalWorkDetail,
	Page,
	PreviewRequest,
	ReviewItem,
	WorkCard,
} from "./domain/model.js";

export type * from "./domain/model.js";
export interface AnimeCatalogApi {
	availableEpisodes(
		reference: import("../metadata/public.js").WorkReference,
	): Promise<{ episodes: number[]; revision: string }>;
	publish(
		results: readonly IdentificationResult[],
		scopeIds: readonly string[],
		signal?: AbortSignal,
		fileIds?: readonly string[],
	): Promise<void>;
	list(query?: CatalogQuery): Promise<Page<WorkCard>>;
	index(query?: CatalogQuery): Promise<{
		items: (import("./domain/model.js").LocalWork & {
			reference: import("../metadata/public.js").WorkReference;
			available: boolean;
		})[];
		epoch: number;
	}>;
	cards(ids: readonly string[], epoch: number): Promise<WorkCard[]>;
	getLocalWorkDetail(id: string): Promise<LocalWorkDetail>;
	findLocalWork(
		reference: import("../metadata/public.js").WorkReference,
	): Promise<string | null>;
	artwork(
		id: string,
		kind: "cover" | "banner",
	): Promise<
		Awaited<ReturnType<MetadataApi["readArtwork"]>> & {
			/** Provider artwork URL digest; clients pin it as `?v=` for long caching. */
			version: string | null;
		}
	>;
	source(fileId: string): Promise<{
		sourceVersion: string;
		associations: ReviewItem["associations"];
	}>;
	review(id: string): Promise<ReviewItem>;
	fileReviews(fileIds: string[]): Promise<ReviewItem[]>;
	reviews(options?: {
		workId?: string;
		decision?: ReviewItem["decision"];
		page?: number;
		perPage?: number;
	}): Promise<Page<ReviewItem>>;
	preview(request: PreviewRequest): Promise<CatalogPreview>;
	confirm(request: Confirmation): Promise<ConfirmationResult>;
	reject(id: string, revision: number, reason: string): Promise<ReviewItem>;
	remove(id: string, revision: number, reason: string): Promise<ReviewItem>;
	editEpisode(
		id: string,
		episodeId: string,
		revision: number,
		number: string,
		label: string,
	): Promise<LocalEpisode>;
	refresh(id: string, revision: number): Promise<LocalWorkDetail>;
	close(): void;
}
