import type { IdentificationResult } from "../identification/public.js";
import type { MetadataApi } from "../metadata/public.js";
import type {
	CatalogPreview,
	CatalogQuery,
	Confirmation,
	ConfirmationResult,
	LocalEpisode,
	Page,
	PreviewRequest,
	ReviewItem,
	WorkCard,
	WorkDetail,
} from "./domain/model.js";

export type * from "./domain/model.js";
export interface AnimeCatalogApi {
	publish(
		results: readonly IdentificationResult[],
		canonicalRoot: string,
		signal?: AbortSignal,
	): Promise<void>;
	list(query?: CatalogQuery): Promise<Page<WorkCard>>;
	detail(id: string): Promise<WorkDetail>;
	artwork(
		id: string,
		kind: "cover" | "banner",
	): ReturnType<MetadataApi["readArtwork"]>;
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
	refresh(id: string, revision: number): Promise<WorkDetail>;
	close(): void;
}
