import type { TrackingProviderDescriptor } from "./model.js";
import type { ViewingStatus } from "./viewing.js";

export type { ViewingStatus } from "./viewing.js";
export interface TrackingListEntry {
	id: string;
	mediaId: string;
	progress: number;
	status: ViewingStatus;
	updatedAt: number | null;
	titles: string[];
	format: string | null;
	year: number | null;
	episodeCount: number | null;
	coverUrl: string | null;
}
export interface TrackingListCache {
	invalidated?: boolean;
	accountId: string;
	fetchedAt: number;
	entries: TrackingListEntry[];
}
export interface TrackingListSnapshot {
	accountId: string | null;
	generation: string;
	provider: TrackingProviderDescriptor;
	state: "disconnected" | "connected" | "authorization-required";
	fetchedAt: number | null;
	stale: boolean;
	refreshing: boolean;
	error: { code: string; retryAt: number | null } | null;
	entries: TrackingListEntry[];
}
export interface TrackingLease {
	accountId: string;
	generation: string;
	credential: string;
	signal: AbortSignal;
}

export type TrackingProviderFailureCode =
	| "busy"
	| "invalid-request"
	| "not-found"
	| "unavailable"
	| "invalid-response"
	| "rate-limited"
	| "unauthorized";
/** Provider-neutral, sanitized failure exposed by the Tracking list port. */
export class TrackingProviderError extends Error {
	constructor(
		readonly code: TrackingProviderFailureCode,
		readonly retryAt: number | null,
	) {
		super("Tracking provider list read failed.");
		this.name = "TrackingProviderError";
	}
}
