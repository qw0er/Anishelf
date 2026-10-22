export interface FeedEntry {
	seeders?: number | null;
	seedersObservedAt?: number | null;
	id: string;
	observationId: string;
	title: string;
	publishedAt: number | null;
	downloadUrl: string | null;
	hash: string | null;
}
export interface FeedRecord {
	revision: string;
	id: string;
	url: string;
	etag: string | null;
	lastModified: string | null;
	checkedAt: number | null;
	nextAttemptAt: number;
	failures: number;
	error: string | null;
	entries: FeedEntry[];
}
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
	rssUrl: string;
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
export class RssError extends Error {
	constructor(readonly code: string) {
		super("RSS operation failed.");
		this.name = "RssError";
	}
}
