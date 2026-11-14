import type {
	TrackingAttempt,
	TrackingDesiredState,
	TrackingRemoteState,
} from "../domain/operation.js";
import type { TrackingProgressInspection } from "../ports.js";

export function matchesRemoteState(
	remote: TrackingRemoteState | null,
	desired: TrackingDesiredState,
): boolean {
	return (
		remote !== null &&
		(desired.progress === undefined || remote.progress === desired.progress) &&
		(desired.status === undefined || remote.status === desired.status)
	);
}
export function matchesAttemptBaseline(
	remote: TrackingRemoteState | null,
	attempt: TrackingAttempt,
): boolean {
	const baseline = attempt.baseline;
	if (!remote || !baseline) return remote === baseline;
	return (
		remote.id === baseline.id &&
		(attempt.desired.progress === undefined ||
			remote.progress === baseline.progress) &&
		(attempt.desired.status === undefined || remote.status === baseline.status)
	);
}

export function hasReachedTrackingIntent(
	remote: TrackingRemoteState | null,
	desired: TrackingDesiredState,
	progress: TrackingProgressInspection | undefined,
	automatic: boolean,
): boolean {
	if (progress === undefined) return matchesRemoteState(remote, desired);
	return (
		progress.state === "matched" &&
		remote !== null &&
		(automatic || remote.progress === desired.progress) &&
		(desired.status === undefined || remote.status === desired.status)
	);
}
