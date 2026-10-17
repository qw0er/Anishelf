import type {
	ExtractionEvidence,
	IdentificationResult,
} from "../../identification/public.js";
import type {
	CachedMetadata,
	ProviderReference,
	WorkDetails,
} from "../../metadata/public.js";

export interface EpisodeTarget {
	kind: "regular" | "special" | "movie";
	number: string;
	label?: string;
}
export interface LocalWork {
	id: string;
	providerTitle: string;
	searchTitles: string[];
	format: string | null;
	year: number | null;
	episodeCount: number | null;
	revision: number;
	createdAt: number;
	updatedAt: number;
}
export interface ProviderLink {
	workId: string;
	reference: ProviderReference;
	snapshotId: string;
}
export interface LocalEpisode {
	id: string;
	workId: string;
	kind: EpisodeTarget["kind"];
	number: string;
	label: string;
	provenance: "confirmed" | "count-derived";
}
export interface Association {
	sourceId: string;
	episodeId: string;
	rawNumbers: string[];
	reason: string;
	operationKey: string;
	offset: number;
}
export interface ReviewItem {
	id: string;
	sourceId: string;
	rootId: string;
	fileId: string;
	relativePath: string;
	sourceVersion: string;
	available: boolean;
	revision: number;
	associations: {
		workId: string;
		workTitle: string;
		reference?: ProviderReference;
		episodeId: string;
		kind: EpisodeTarget["kind"];
		number: string;
		label: string;
	}[];
	recognizedWork?: {
		reference: ProviderReference;
		title: string;
		mappingStatus: "resolved" | "pending";
	};
	decision: "pending" | "confirmed" | "rejected";
	reason: string | null;
	evidence: ExtractionEvidence;
	proposals: IdentificationResult["proposals"];
	metadataStatus: IdentificationResult["metadataStatus"];
	unresolved: string[];
}
/** Internal source membership; the HTTP projection retains its existing opaque rootId field. */
export interface ReviewRecord
	extends Omit<ReviewItem, "associations" | "recognizedWork"> {
	scopeId: string;
}
export interface MappingSelection {
	reviewId: string;
	revision: number;
	targets: EpisodeTarget[];
	/** Applied only to this explicitly selected row's regular targets. */
	offset?: number;
	reason: string;
}
export interface PreviewRequest {
	reference: ProviderReference;
	rows: MappingSelection[];
}
interface PreviewRow {
	reviewId: string;
	revision: number;
	relativePath: string;
	rawNumbers: string[];
	before: {
		workId: string;
		episodeId: string;
		kind: EpisodeTarget["kind"];
		number: string;
	}[];
	targets: EpisodeTarget[];
	offset: number;
	reason: string;
}
export interface CatalogPreview {
	id: string;
	expiresAt: number;
	reference: ProviderReference;
	workId: string | null;
	workRevision: number | null;
	metadata: CachedMetadata<WorkDetails>;
	rows: PreviewRow[];
}
export interface Confirmation {
	operationKey: string;
	previewId: string;
	replace: boolean;
}
export interface ConfirmationResult {
	workId: string;
	revision: number;
	reviewIds: string[];
}
export interface CatalogQuery {
	query?: string;
	format?: string;
	year?: number;
	availability?: "available" | "unavailable";
	sort?: "title" | "recent";
	page?: number;
	perPage?: number;
}
export interface Page<T> {
	items: T[];
	page: number;
	perPage: number;
	hasNextPage: boolean;
}
export interface WorkCard extends LocalWork {
	availableTrackingEpisodes?: number[];
	displayTitle: string;
	hasCover: boolean;
	metadataStale: boolean;
	reference: ProviderReference;
	availableEpisodes: number;
	availableRegularEpisodes: number;
}
interface SourceVersion {
	reviewId: string;
	sourceId: string;
	fileId: string;
	relativePath: string;
	sourceVersion: string;
	available: boolean;
	evidence: ExtractionEvidence;
	mapping: { rawNumbers: string[]; reason: string; offset: number };
}
export interface LocalWorkDetail {
	work: WorkCard;
	metadata: CachedMetadata<WorkDetails>;
	hasBanner: boolean;
	episodes: (LocalEpisode & {
		versions: SourceVersion[];
		availability: "available" | "unavailable" | "missing";
	})[];
	/** Known provider count is information; slots are not canonical provider episodes. */
	episodeCountProvenance: "provider-count" | "unknown";
}
