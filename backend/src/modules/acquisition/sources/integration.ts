import type { SourceSnapshot } from "./public.js";
/** Internal synchronous publication joins source writes and candidate writes in one transaction. */
export interface SourcePublication {
	readonly snapshot: SourceSnapshot;
	commit(writeCandidates: () => void): void;
}
export interface SourceCollection {
	/** Source failures and backoff are recorded here, never by a consumer. */
	collect(id: string): Promise<SourcePublication>;
}
export interface SourcesRuntime {
	start(
		activeIds: () => string[],
		poll: (source: SourceSnapshot) => Promise<void>,
	): void;
	close(): Promise<void>;
}
