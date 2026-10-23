import type {
	SourceConnectorApi,
	SourceInput,
	SourceTestResult,
} from "./settings.js";

export type {
	SourceConnectorApi,
	SourceInput,
} from "./settings.js";

import type { DownloadContent, SearchCoverage } from "./domain/evidence.js";

export type {
	DownloadContent,
	ReleaseEvidence,
} from "./domain/evidence.js";
export { SourceError } from "./domain/model.js";

import type { ReleaseEvidence } from "./domain/evidence.js";

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

/** Catalog capability used by Subscriptions. Configuration stays at source setup. */
export interface SourcesApi {
	configure(input: SourceInput): string;
	snapshot(id: string): SourceSnapshot | null;
}
/** Download capability: consumers never receive protocol configuration. */
export interface SourceContentApi {
	read(reference: string, signal: AbortSignal): Promise<DownloadContent>;
	isCurrent(reference: string): boolean;
}
export interface SourceManagementApi extends SourcesApi {
	readonly connector: SourceConnectorApi;
	test(input: SourceInput | string): Promise<SourceTestResult>;
}
