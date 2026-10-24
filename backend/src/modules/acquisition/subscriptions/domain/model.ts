import type { SourceInput } from "../../sources/public.js";

export interface Subscription {
	discovery?: {
		checkedAt: number;
		attempts: SubscriptionSearchResult["attempts"];
	};
	createdBy?: "watching";
	automatic?: {
		sourceGeneration: string;
		profileFingerprint: string;
		target: {
			destinationRevision: string;
			connectionGeneration: string;
		} | null;
		retryAt: number;
	} | null;
	sourceInput?: SourceInput | null;
	profileId?: string | null;
	lastError?: string | null;
	workKey: string;
	feedId: string | null;
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
	discovery?: NonNullable<Subscription["discovery"]>;
	subscription:
		| (Omit<Subscription, "sourceInput"> & {
				source: string;
				sourceKind: "feed" | "search" | "automatic";
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
	source: SourceInput | { kind: "automatic" } | null;
	startEpisode: number;
	profileId?: string | null;
	revision: string | null;
	/** null explicitly saves a discovery-only subscription; HTTP activation requires a target. */
	target: { destinationRevision: string; connectionGeneration: string } | null;
}

export interface SubscriptionSearchInput {
	workKey: string;
	revision: string | null;
	startEpisode: number;
	profileId?: string | null;
}
export interface SubscriptionSearchResult {
	source: {
		kind: "search";
		connectionRevision: string;
		providerId: string;
		titles: string[];
	} | null;
	attempts: {
		providerId: string;
		outcome: "matched" | "no_match" | "no_eligible" | "unavailable";
		reasons: string[];
		code: string | null;
		retryAt?: number;
		limited: boolean;
	}[];
	releases: {
		id: string;
		title: string;
		episode: number | null;
		waiting: boolean;
	}[];
}
