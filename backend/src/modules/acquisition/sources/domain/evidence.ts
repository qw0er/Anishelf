/** Protocol-neutral evidence consumed by assessment and acquisition. */
export interface ReleaseAttributes {
	id: string;
	observationId: string;
	title: string;
	publishedAt: number | null;
	hash: string | null;
	size?: number | null;
	peers?: number | null;
	seeders?: number | null;
	seedersObservedAt?: number | null;
}
export interface ReleaseEvidence extends ReleaseAttributes {
	/** Opaque persisted locator. Only Sources can resolve it. */
	download: string | null;
}
export interface SearchCoverage {
	limited: boolean;
	reason:
		| "accepted"
		| "page_limit"
		| "repeated_page"
		| "missing_pagination"
		| "item_limit"
		| null;
	pages: number;
	queries: number;
}
export type DownloadContent =
	| { kind: "bytes"; bytes: Uint8Array }
	| { kind: "magnet"; uri: string };
