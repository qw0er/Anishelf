export { MetadataError } from "./metadata/public.js";

import type { AnimeCatalogApi } from "./anime-catalog/public.js";
import type { AnimeLibraryApi } from "./anime-library/public.js";
import type { MetadataApi } from "./metadata/public.js";
import type { TrackingApi } from "./tracking/public.js";

export type {
	AcquisitionTarget,
	ReleaseAssessmentApi,
	ReleaseAttributes,
} from "./release-assessment/public.js";

import type { ReleaseAssessmentApi } from "./release-assessment/public.js";
export interface AnimeApi {
	readonly acquisition?: ReleaseAssessmentApi;
	readonly acquisitionList?: {
		snapshot(): {
			accountId: string | null;
			generation: string;
			revision: string | null;
			complete: boolean;
			fresh: boolean;
			refreshAllowed: boolean;
			retryAt: number | null;
			entries: {
				workKey: string;
				title: string;
				status: string;
				progress: number;
			}[];
		};
		refresh(): Promise<
			ReturnType<NonNullable<AnimeApi["acquisitionList"]>["snapshot"]>
		>;
	};
	readonly ingestion?: {
		ingest(
			key: string,
			episode: number,
			identity: import("../resources/public.js").SourceIdentity,
			signal: AbortSignal,
		): Promise<"available" | "review">;
	};
	readonly queries: {
		detail(
			input: { localWorkId: string } | { key: string },
		): Promise<AnimeDetail>;
	};
	readonly library: AnimeLibraryApi;
	readonly tracking: TrackingApi;
	readonly metadata:
		| Pick<MetadataApi, "search" | "get" | "relations" | "airing" | "snapshot">
		| undefined;
	readonly catalog:
		| Pick<
				AnimeCatalogApi,
				| "list"
				| "getLocalWorkDetail"
				| "source"
				| "reviews"
				| "fileReviews"
				| "review"
				| "preview"
				| "confirm"
				| "reject"
				| "remove"
				| "editEpisode"
				| "refresh"
		  >
		| undefined;
}

export interface AnimeDetail {
	reference: import("../../shared/external-reference.js").ExternalWorkReference;
	displayTitle: string;
	metadata:
		| import("./metadata/public.js").CachedMetadata<
				import("./metadata/public.js").WorkDetails
		  >
		| null;
	metadataError: import("./metadata/public.js").MetadataFailure | null;
	local: import("./anime-catalog/public.js").LocalWorkDetail | null;
	viewing: Omit<
		import("./tracking/public.js").TrackingListSnapshot,
		"entries"
	> & { entry: import("./tracking/public.js").TrackingListEntry | null };
}
