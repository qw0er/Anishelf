export interface JackettConfiguration {
	version: 1;
	generation: string;
	connection: {
		url: string;
		managementUrl?: string | null;
		apiKey: string | null;
		origin: "bundled" | "external";
		indexers: string[];
	} | null;
}
export interface JackettUpdate {
	generation: string;
	url: string;
	managementUrl?: string | null;
	apiKey?: string | null;
	origin: "bundled" | "external";
	indexers: string[];
}
export interface JackettCapabilities {
	search: boolean;
	limit: number;
}
export type {
	DownloadContent as TorrentRead,
	SearchCoverage,
} from "../domain/evidence.js";
