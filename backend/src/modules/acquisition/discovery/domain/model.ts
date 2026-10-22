import type { SourceReference } from "../../sources/public.js";

export interface Subscription {
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
		| (Subscription & {
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
export interface PreviewInput {
	profileId?: string | null;
	workKey: string;
	source: SourceReference | null;
	startEpisode: number;
	revision: string | null;
}
export interface SubscriptionPreview {
	downloadDestination?: string | null;
	token: string;
	expiresAt: number;
	source: string;
	startEpisode: number;
	availableEpisodes: number[];
	knownEpisodeCount: number | null;
	candidates: Candidate[];
	total: number;
}
