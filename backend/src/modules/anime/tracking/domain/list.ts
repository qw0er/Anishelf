const viewingStatuses = [
	"CURRENT",
	"PLANNING",
	"COMPLETED",
	"PAUSED",
	"DROPPED",
	"REPEATING",
] as const;
export type ViewingStatus = (typeof viewingStatuses)[number];
export interface TrackingListEntry {
	id: number;
	mediaId: number;
	progress: number;
	status: ViewingStatus;
	updatedAt: number;
	titles: string[];
	format: string | null;
	year: number | null;
	episodeCount: number | null;
	coverUrl: string | null;
}
export interface TrackingListCache {
	accountId: number;
	fetchedAt: number;
	entries: TrackingListEntry[];
}
export interface TrackingListSnapshot {
	accountId: number | null;
	generation: string;
	state: "disconnected" | "connected" | "authorization-required";
	fetchedAt: number | null;
	stale: boolean;
	refreshing: boolean;
	error: { code: string; retryAt: number | null } | null;
	entries: TrackingListEntry[];
}
export interface TrackingLease {
	accountId: number;
	generation: string;
	token: string;
	signal: AbortSignal;
}
