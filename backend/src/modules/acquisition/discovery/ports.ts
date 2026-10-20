import type { Candidate, FeedRecord, Subscription } from "./domain/model.js";
export interface DiscoveryStore {
	subscription(workKey: string): Subscription | null;
	subscriptions(): Subscription[];
	feed(id: string): FeedRecord | null;
	candidates(workKey: string): Candidate[];
	saveFeed(feed: FeedRecord): void;
	saveSubscription(
		subscription: Subscription,
		feed: FeedRecord,
		candidates: Candidate[],
	): void;
	updateCandidates(
		subscription: Subscription,
		candidates: Candidate[],
		error?: string | null,
	): boolean;
	remove(workKey: string, revision: string): boolean;
}
interface FeedResponse {
	xml: string | null;
	etag: string | null;
	lastModified: string | null;
}
export interface FeedTransport {
	fetch(
		url: string,
		validators: { etag: string | null; lastModified: string | null },
		signal: AbortSignal,
	): Promise<FeedResponse>;
	close(): Promise<void>;
}
