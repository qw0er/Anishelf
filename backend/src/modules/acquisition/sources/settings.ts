import type { SearchCoverage } from "./domain/evidence.js";
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
export interface SourceTestResult {
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
