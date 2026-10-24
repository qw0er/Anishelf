import type { Logger } from "pino";
import type { FeedRecord } from "../domain/model.js";
import type { SourceRequestGate } from "../infrastructure/request-gate.js";

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
	/** Admission is owned by the transport, including redirected requests. */
	readonly requestGate?: SourceRequestGate | undefined;
	fetch(
		url: string,
		validators: { etag: string | null; lastModified: string | null },
		signal: AbortSignal,
	): Promise<FeedResponse>;
	close(): Promise<void>;
}

export interface RssSourceOptions {
	gate?: SourceRequestGate;
	store: SourceStore;
	transport: FeedTransport;
	parse: (xml: string) => FeedRecord["entries"];
	normalizeUrl: (url: string) => string;
	logger: Logger;
}
