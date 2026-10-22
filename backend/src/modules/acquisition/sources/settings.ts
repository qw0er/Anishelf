import type {
	JackettCapabilities,
	JackettPlan,
	JackettUpdate,
	SearchCoverage,
} from "./jackett/model.js";

interface SourceConnectionSettings {
	generation: string;
	url: string | null;
	origin: "bundled" | "external" | null;
	indexers: string[];
	hasApiKey: boolean;
	ready: boolean;
	error: string | null;
}
export interface SourceConnectionApi {
	settings(): SourceConnectionSettings;
	save(input: JackettUpdate): Promise<SourceConnectionSettings>;
	clear(generation: string): Promise<SourceConnectionSettings>;
	indexers(generation: string): Promise<{ id: string; name: string }[]>;
	probe(
		generation: string,
		indexerId: string,
	): Promise<{
		generation: string;
		indexerId: string;
		capabilities: JackettCapabilities;
		searchVerified: false;
	}>;
	search(plan: JackettPlan): Promise<{
		source: string;
		outcome: "matches" | "no_match";
		coverage: SearchCoverage;
		entries: {
			id: string;
			title: string;
			publishedAt: number | null;
			size: number | null;
			seeders: number | null;
			peers: number | null;
			downloadAvailable: boolean;
		}[];
	}>;
}
