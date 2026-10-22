export type { FeedRecord, ReleaseEvidence } from "./domain/model.js";
export { RssError } from "./domain/model.js";
export type { FeedTransport, SourceStore } from "./ports.js";

import type { FeedRecord } from "./domain/model.js";
export interface SourcesApi {
	normalizeUrl(url: string): string;
	feed(id: string): FeedRecord | null;
	saveFeed(feed: FeedRecord): void;
	fetch(feed: FeedRecord): Promise<FeedRecord>;
	failed(feed: FeedRecord, code: string): void;
	start(
		activeIds: () => string[],
		poll: (feed: FeedRecord) => Promise<void>,
	): void;
	close(): Promise<void>;
}
