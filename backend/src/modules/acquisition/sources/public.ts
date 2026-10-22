export type { SourceConnectionApi } from "./settings.js";

import type { SearchCoverage } from "./jackett/model.js";

export type { ReleaseEvidence } from "./domain/model.js";
export { SourceError } from "./domain/model.js";
export type { FeedTransport } from "./ports.js";

import type { ReleaseEvidence } from "./domain/model.js";

/** Opaque binding issued by Sources; protocol configuration stays private. */
export interface SourceReference {
	readonly id: string;
}

/** Consumer evidence excludes feed URLs, HTTP validators and protocol cursors. */
export interface SourceSnapshot {
	readonly coverage?: SearchCoverage;
	readonly outcome?: "matches" | "no_match";
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
	/** Resolve a previously published binding without making a network request. */
	reference(id: string): SourceReference;
	/** Refresh any configured source without persisting evidence or authorizing work. */
	refresh(reference: SourceReference): Promise<SourceSnapshot>;
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
