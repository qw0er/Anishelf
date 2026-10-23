import type { AnimeApi, ReleaseAssessmentApi } from "../../anime/public.js";
import type { AcquisitionResources } from "../../resources/public.js";
import type { Candidate, Subscription } from "../discovery/public.js";
import {
	DownloadContext,
	type DownloadOptions,
} from "../downloads/application/context.js";
import type { ReleaseEvidence } from "../sources/public.js";

/** Consumer-owned reads and an explicit result notification; no Discovery persistence access. */
interface DownloadSelection {
	subscription(workKey: string): Subscription | null;
	subscriptions(): Subscription[];
	candidates(workKey: string): Candidate[];
	release(
		feedId: string,
		entryId: string,
	): Pick<ReleaseEvidence, "download" | "hash"> | null;
	reservationOutcome(subscription: Subscription, failed: boolean): void;
}

export interface AcquisitionOptions extends DownloadOptions {
	initializeBundled?: () => Promise<boolean>;
	store: import("../downloads/public.js").DownloadStore;
	selection: DownloadSelection;
	resources: AcquisitionResources;
	anime: ReleaseAssessmentApi;
	ingestion: NonNullable<AnimeApi["ingestion"]>;
}
/** Cross-module decisions and admission share the transfer lifetime and revision fence. */
export class AcquisitionContext extends DownloadContext {
	constructor(override readonly options: AcquisitionOptions) {
		super(options);
	}
}
