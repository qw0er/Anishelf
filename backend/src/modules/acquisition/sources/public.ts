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

export type SourceInput =
	| { kind: "feed"; url: string }
	| {
			kind: "search";
			connectionRevision: string;
			providerId: string;
			titles: readonly string[];
	  };
interface SourceConnectorSettings {
	generation: string;
	url: string | null;
	origin: "bundled" | "external" | null;
	providers: string[];
	hasApiKey: boolean;
	ready: boolean;
	error: string | null;
}
interface SourceConnectorUpdate {
	generation: string;
	url: string;
	apiKey?: string | null;
	origin: "bundled" | "external";
	providers: string[];
}
export interface SourceConnectorApi {
	settings(): SourceConnectorSettings;
	save(input: SourceConnectorUpdate): Promise<SourceConnectorSettings>;
	clear(generation: string): Promise<SourceConnectorSettings>;
	providers(generation: string): Promise<{ id: string; name: string }[]>;
	probe(
		generation: string,
		providerId: string,
	): Promise<{
		generation: string;
		providerId: string;
		searchSupported: boolean;
		searchVerified: false;
	}>;
}
interface SourceTestResult {
	source: string;
	outcome: "matches" | "no_match";
	coverage?: SearchCoverage;
	entries: {
		id: string;
		title: string;
		publishedAt: number | null;
		size: number | null;
		seeders: number | null;
		peers: number | null;
		downloadAvailable: boolean;
	}[];
}
