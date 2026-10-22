import type { FeedRecord } from "./domain/model.js";
export interface SourceStore {
	feed(id: string): FeedRecord | null;
	saveFeed(feed: FeedRecord): void;
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
