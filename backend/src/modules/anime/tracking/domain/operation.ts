import type { ViewingStatus } from "./list.js";
export interface TrackingRemoteState {
	id: string;
	progress: number;
	status: ViewingStatus;
	updatedAt: number | null;
}
export interface TrackingDesiredState {
	progress?: number;
	status?: ViewingStatus;
}
export interface TrackingAttempt {
	revision: number;
	baseline: TrackingRemoteState | null;
	desired: TrackingDesiredState;
}
type TrackingOrigin = "manual-detail" | "manual-player" | "automatic";
export interface TrackingEpisodeTarget {
	fileId: string;
	sourceVersion: string;
	reviewId: string;
	mappingRevision: number;
	episodeId: string;
	mediaId: string;
	episode: number;
}
type TrackingDecisionReason = "skipped-episodes" | "initial-status-required";
export interface TrackingOperation {
	origin: TrackingOrigin;
	commandId: string;
	intentAt: number;
	target: TrackingEpisodeTarget | null;
	decisionReason: TrackingDecisionReason | null;
	id: string;
	accountId: string;
	mediaId: string;
	revision: number;
	baseline: TrackingRemoteState | null;
	desired: TrackingDesiredState;
	state:
		| "decision-required"
		| "pending"
		| "submitting"
		| "failed"
		| "conflict"
		| "authorization-required"
		| "succeeded"
		| "cancelled";
	remote: TrackingRemoteState | null;
	attempt: TrackingAttempt | null;
	attempts: number;
	retryAt: number | null;
	error: string | null;
	updatedAt: number;
}
export interface TrackingUpdate {
	cancelled?: boolean;
	commandId?: string;
	origin?: TrackingOrigin;
	target?: TrackingEpisodeTarget;
	decisionReason?: TrackingDecisionReason;
	generation: string;
	revision: number | null;
	baseline: TrackingRemoteState | null;
	desired: TrackingDesiredState;
}
export interface TrackingOperationCommand {
	generation: string;
	revision: number;
}
