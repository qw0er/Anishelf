import type { TrackingPreview, TrackingStatus } from "./domain/model.js";

export type {
	TrackingListEntry,
	TrackingListSnapshot,
	ViewingStatus,
} from "./domain/list.js";
export interface TrackingApi {
	status(): TrackingStatus;
	preview(sessionId: string, token: string): Promise<TrackingPreview>;
	confirm(
		sessionId: string,
		candidateId: string,
		generation: string,
	): Promise<TrackingStatus>;
	disconnect(generation: string): Promise<TrackingStatus>;
	check(): Promise<TrackingStatus>;
}

export interface TrackingListsApi {
	list(
		generation?: string,
		refreshStale?: boolean,
	): import("./domain/list.js").TrackingListSnapshot;
	refreshList(
		generation?: string,
	): Promise<import("./domain/list.js").TrackingListSnapshot>;
}
