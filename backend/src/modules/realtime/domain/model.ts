import type { MediaTimeline } from "../../../contracts/http.js";
import type { DerivedMediaIdentity } from "../../../shared/media-preparation.js";

/** Runtime leases are not durable viewing history or reusable completed artifacts. */
export interface RealtimeSession {
	id: string;
	identity: DerivedMediaIdentity;
	status: "starting" | "streaming" | "completed" | "stopped" | "failed";
	resourceId: string | null;
	streamGeneration: number;
	timeline: MediaTimeline;
	leaseExpiresAtMs: number;
	executionId: string | null;
}
export interface RealtimeApi {
	get(id: string): Promise<RealtimeSession>;
	heartbeat(id: string): Promise<void>;
	seek(
		id: string,
		sourcePositionMs: number,
		streamGeneration: number,
	): Promise<RealtimeSession>;
	release(id: string): Promise<void>;
}
