import type { TrackingPreview, TrackingStatus } from "./domain/model.js";

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
