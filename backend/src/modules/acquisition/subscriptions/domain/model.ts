import type { SourceInput } from "../../sources/public.js";

export interface Subscription {
	sourceInput?: SourceInput | null;
	profileId?: string | null;
	lastError?: string | null;
	workKey: string;
	feedId: string;
	startEpisode: number;
	enabled: boolean;
	revision: string;
}
export interface Candidate {
	selection?: {
		profileId: string;
		fingerprint: string;
		level: string | null;
		firstSeenAt: number | null;
		eligibleAt: number | null;
		seeders: number | null;
	};
	chosen?: boolean;
	id: string;
	workKey: string;
	entryId: string;
	title: string;
	episode: number | null;
	status: "selected" | "skipped";
	reasons: string[];
	version: string;
	snapshotId: string;
	publishedAt: number | null;
}
export interface SubscriptionView {
	subscription:
		| (Omit<Subscription, "sourceInput"> & {
				source: string;
				checkedAt: number | null;
				nextAttemptAt: number;
				error: string | null;
		  })
		| null;
	candidates: Candidate[];
	total: number;
	page: number;
}
export interface SubscriptionAuthorization {
	workKey: string;
	feedId: string;
	startEpisode: number;
	destinationRevision: string;
	connectionGeneration: string;
}
export interface SaveSubscriptionInput {
	workKey: string;
	source: SourceInput | null;
	startEpisode: number;
	profileId?: string | null;
	revision: string | null;
	/** null explicitly saves a discovery-only subscription; HTTP activation requires a target. */
	target: { destinationRevision: string; connectionGeneration: string } | null;
}
