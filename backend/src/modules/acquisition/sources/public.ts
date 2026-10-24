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

/** Unified source operations; adapter implementations remain private. */
export interface SourcesApi {
	snapshot(input: SourceInput | string): SourceSnapshot | null;
	fetch(input: SourceInput | string): Promise<SourcePublication>;
	readContent(reference: string, signal: AbortSignal): Promise<DownloadContent>;
	isContentCurrent(reference: string): boolean;
	readonly connector: SourceConnectorApi;
	test(input: SourceInput | string): Promise<SourceTestResult>;
}
/** Source evidence and candidate writes share one synchronous transaction. */
export interface SourcePublication {
	readonly snapshot: SourceSnapshot;
	commit(writeCandidates: () => void): void;
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
	bundledAvailable?: boolean;
	bundledSetup?: "waiting" | "pending" | "complete" | "manual";
	managementUrl?: string | null;
	generation: string;
	url: string | null;
	origin: "bundled" | "external" | null;
	providers: string[];
	hasApiKey: boolean;
	ready: boolean;
	error: string | null;
}
interface SourceConnectorUpdate {
	managementUrl?: string | null;
	generation: string;
	url: string;
	apiKey?: string | null;
	origin: "bundled" | "external";
	providers: string[];
}
export interface SourceConnectorApi {
	settings(): SourceConnectorSettings;
	useBundled(
		generation: string,
		initializeSite?: boolean,
	): Promise<SourceConnectorSettings>;
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
