export interface ReleaseEvidence {
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
	entries: ReleaseEvidence[];
}
export class RssError extends Error {
	constructor(readonly code: string) {
		super("RSS operation failed.");
		this.name = "RssError";
	}
}
