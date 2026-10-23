import type { ReleaseDownload } from "../jackett/model.js";
import type { ReleaseAttributes, SearchCoverage } from "./evidence.js";
/** Private adapter evidence. Locators must never cross the consumer boundary. */
export interface SourceEntry extends ReleaseAttributes {
	guid?: string;
	sourceId?: string;
	generation?: string;
	download?: ReleaseDownload | null;
	downloadUrl: string | null;
}
export interface SourceRecord {
	coverage?: SearchCoverage;
	outcome?: "matches" | "no_match";
	id: string;
	revision: string;
	label: string;
	entries: readonly SourceEntry[];
	checkedAt: number | null;
	nextAttemptAt: number;
	error: string | null;
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
	entries: SourceEntry[];
}
export class SourceError extends Error {
	constructor(
		readonly code: string,
		readonly retryAt?: number,
	) {
		super("Source operation failed.");
		this.name = "SourceError";
	}
}
