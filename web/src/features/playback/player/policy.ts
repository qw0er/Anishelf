export interface PlaybackPolicy {
	readonly progressSaveIntervalMs: number;
	readonly requestTimeoutMs: number;
	readonly progressRetryInitialMs: number;
	readonly progressRetryMaximumMs: number;
	readonly progressSeekDelayMs: number;
}
export const playbackPolicy: PlaybackPolicy = Object.freeze({
	progressSaveIntervalMs: 15000,
	requestTimeoutMs: 15000,
	progressRetryInitialMs: 5000,
	progressRetryMaximumMs: 60000,
	progressSeekDelayMs: 500,
});
export const playbackInteractionPolicy = Object.freeze({
	seekStepSeconds: 5,
	playerLoad: "eager" as const,
	playerPreload: "metadata" as const,
});
