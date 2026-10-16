import {
	type DeepReadonly,
	freeze,
	requirePolicy,
	validateNumericPolicy,
} from "../../../shared/policy.js";

const defaults = {
	completionRatio: 0.9,
	minimumNormalPlayMs: 30000,
	sessionIdleMs: 30 * 60 * 1000,
	maximumSessions: 1000,
	historyLimit: 100,
	maximumListLimit: 100,
	candidateBatchSize: 100,
	nearEndMs: 30000,
	nearEndRatio: 0.05,
};
export type PlaybackPolicy = typeof defaults;
export const playbackPolicy = freeze(defaults);
export function validatePlaybackPolicy(
	policy: DeepReadonly<PlaybackPolicy>,
): void {
	validateNumericPolicy("playback", policy, defaults);
	requirePolicy(
		policy.completionRatio > 0 && policy.completionRatio <= 1,
		"playback.completionRatio",
	);
	requirePolicy(
		policy.historyLimit <= policy.maximumListLimit,
		"playback.defaultListLimits",
	);
}
