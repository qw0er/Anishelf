export { MetadataError } from "./external-works/metadata/public.js";
export { isActiveViewing } from "./external-works/tracking/public.js";

import type { AnimeCatalogApi } from "./anime-catalog/public.js";
import type { AnimeLibraryApi } from "./anime-library/public.js";
import type { MetadataApi } from "./external-works/metadata/public.js";
import type { TrackingApi } from "./external-works/tracking/public.js";

export type {
	AcquisitionTarget,
	ReleaseAssessmentApi,
	ReleaseAttributes,
} from "./release-assessment/public.js";

import type { SourceIdentity } from "../resources/public.js";
import type { ReleaseAssessmentApi } from "./release-assessment/public.js";
export interface AcceptedAcquisitionTarget {
	workKey: string;
	reference: { id: string };
	episode: number;
	/** Exact regular episodes authorized together for an indivisible video. */
	fileEpisodes?: readonly number[];
	snapshotId: string;
}
export interface AcquisitionProvenance {
	intentId: string;
	candidateId: string;
	title: string;
	hash: string;
	transfer: string | null;
	target: AcceptedAcquisitionTarget;
	warnings: string[];
}
export interface AcquisitionReview {
	id: string;
	/** Changes with the Catalog decision or its committed episode links. */
	decisionKey: string;
	disposition: "available" | "pending" | "protected" | "rejected";
}
export interface AcquisitionCommitGuard {
	verify(): Promise<void>;
	assertCurrent(): void;
}
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
		captureTarget?(
			key: string,
			episode: number,
			signal: AbortSignal,
		): Promise<AcceptedAcquisitionTarget>;
		retainTarget?(target: AcceptedAcquisitionTarget, intentId: string): void;
		releaseTarget?(target: AcceptedAcquisitionTarget, intentId: string): void;
		recoverableReview?(identity: SourceIdentity): Promise<boolean>;
		reviewAcquisition?(
			identity: SourceIdentity,
			target: AcceptedAcquisitionTarget,
		): Promise<AcquisitionReview | null>;
		ingest(
			key: string,
			episode: number,
			identity: SourceIdentity,
			signal: AbortSignal,
			provenance?: AcquisitionProvenance,
			guard?: AcquisitionCommitGuard,
		): Promise<"available" | "review">;
	};
	readonly queries: {
		detail(
			input: { localWorkId: string } | { key: string } | { metadataId: string },
		): Promise<AnimeDetail>;
	};
	readonly library: AnimeLibraryApi;
	readonly tracking: TrackingApi;
	readonly metadata:
		| Pick<
				MetadataApi,
				| "search"
				| "get"
				| "relations"
				| "airing"
				| "snapshot"
				| "artwork"
				| "readArtwork"
				| "cachedArtworkId"
		  >
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
	reference: import("@anishelf/contracts/references").ExternalWorkReference;
	displayTitle: string;
	metadata:
		| import("./external-works/metadata/public.js").CachedMetadata<
				import("./external-works/metadata/public.js").WorkDetails
		  >
		| null;
	metadataError:
		| import("./external-works/metadata/public.js").MetadataFailure
		| null;
	local: import("./anime-catalog/public.js").LocalWorkDetail | null;
}
