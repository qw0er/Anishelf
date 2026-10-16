import type { ViewingStatus } from "./list.js";
export interface TrackingRemoteState {
	id: number;
	progress: number;
	status: ViewingStatus;
	updatedAt: number;
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
export interface TrackingOperation {
	completion?: boolean;
	id: string;
	accountId: number;
	mediaId: number;
	revision: number;
	baseline: TrackingRemoteState | null;
	desired: TrackingDesiredState;
	state:
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
	completion?: boolean;
	generation: string;
	revision: number | null;
	baseline: TrackingRemoteState | null;
	desired: TrackingDesiredState;
}
export interface TrackingOperationCommand {
	generation: string;
	revision: number;
}
