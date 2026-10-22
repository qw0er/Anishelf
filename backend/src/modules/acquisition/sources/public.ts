export type { ReleaseEvidence } from "./domain/model.js";
export { SourceError } from "./domain/model.js";
export type { FeedTransport } from "./ports.js";

import type { ReleaseEvidence } from "./domain/model.js";

/** RSS reads and work-derived queries have distinct protocol semantics. */
export type SourceRequest =
	| { kind: "rss"; url: string }
	| {
			kind: "query";
			sourceId: string;
			generation: string;
			titles: readonly string[];
	  };

/** Consumer evidence excludes feed URLs, HTTP validators and protocol cursors. */
export interface SourceSnapshot {
	readonly id: string;
	readonly revision: string;
	readonly label: string;
	readonly entries: readonly Readonly<ReleaseEvidence>[];
	readonly checkedAt: number | null;
	readonly nextAttemptAt: number;
	readonly error: string | null;
}

export interface SourcesApi {
	/** Saved evidence only; no remote request. */
	snapshot(id: string): SourceSnapshot | null;
	/** Prepare isolated evidence. Neither method persists or authorizes work. */
	read(request: SourceRequest): Promise<SourceSnapshot>;
	refresh(id: string): Promise<SourceSnapshot>;
	/** Recheck immediately before publication and inside admission transactions. */
	isCurrent(result: SourceSnapshot): boolean;
	/** Publish only a prepared, current result, using the caller's transaction. */
	publish(result: SourceSnapshot): void;
	failed(previous: SourceSnapshot, code: string): void;
	start(
		activeIds: () => string[],
		poll: (source: SourceSnapshot) => Promise<void>,
	): void;
	close(): Promise<void>;
}
