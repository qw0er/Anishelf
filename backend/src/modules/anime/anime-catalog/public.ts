import type { IdentificationResult } from "../identification/public.js";
import type { MetadataApi } from "../metadata/public.js";
import type {
	CatalogPreview,
	CatalogQuery,
	Confirmation,
	ConfirmationResult,
	LocalEpisode,
	LocalWork,
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
	): void;
	list(query?: CatalogQuery): Promise<Page<WorkCard>>;
	detail(id: string): Promise<WorkDetail>;
	artwork(
		id: string,
		kind: "cover" | "banner",
	): ReturnType<MetadataApi["readArtwork"]>;
	reviews(options?: {
		decision?: ReviewItem["decision"];
		page?: number;
		perPage?: number;
	}): Promise<Page<ReviewItem>>;
	preview(request: PreviewRequest): Promise<CatalogPreview>;
	confirm(request: Confirmation): Promise<ConfirmationResult>;
	reject(id: string, revision: number, reason: string): Promise<ReviewItem>;
	remove(id: string, revision: number, reason: string): Promise<ReviewItem>;
	editWork(
		id: string,
		revision: number,
		title: string | null,
		aliases: string[],
	): Promise<LocalWork>;
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
