export interface JackettConfiguration {
	version: 1;
	generation: string;
	connection: {
		url: string;
		apiKey: string | null;
		origin: "bundled" | "external";
		indexers: string[];
	} | null;
}
export interface JackettUpdate {
	generation: string;
	url: string;
	apiKey?: string | null;
	origin: "bundled" | "external";
	indexers: string[];
}
export interface JackettPlan {
	generation: string;
	indexerId: string;
	titles: readonly string[];
}
export interface JackettCapabilities {
	search: boolean;
	limit: number;
}
export type { SearchCoverage } from "../domain/evidence.js";
export type ReleaseDownload =
	| { kind: "magnet"; uri: string }
	| { kind: "public-torrent"; url: string }
	| {
			kind: "jackett-torrent";
			generation: string;
			indexerId: string;
			path: string;
			file: string;
	  };
export type { DownloadContent as TorrentRead } from "../domain/evidence.js";
