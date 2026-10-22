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
export interface SearchCoverage {
	limited: boolean;
	reason:
		| "page_limit"
		| "repeated_page"
		| "missing_pagination"
		| "item_limit"
		| null;
	pages: number;
	queries: number;
}
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
export type TorrentRead =
	| { kind: "bytes"; bytes: Uint8Array }
	| { kind: "magnet"; uri: string };
