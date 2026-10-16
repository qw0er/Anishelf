import type { TrackingListSnapshot } from "./domain/list.js";
import type { TrackingPreview, TrackingStatus } from "./domain/model.js";

export type {
	TrackingListEntry,
	TrackingListSnapshot,
	ViewingStatus,
} from "./domain/list.js";
export interface TrackingAccountsApi {
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
	list(generation?: string, refreshStale?: boolean): TrackingListSnapshot;
	refreshList(generation?: string): Promise<TrackingListSnapshot>;
}

/** Complete Tracking capability; consumers may request narrower account/list ports. */
export interface TrackingApi extends TrackingAccountsApi, TrackingListsApi {}
