export interface PlaybackPolicy {
	readonly progressSaveIntervalMs: number;
	readonly requestTimeoutMs: number;
}
export const playbackPolicy: PlaybackPolicy = Object.freeze({
	progressSaveIntervalMs: 5000,
	requestTimeoutMs: 5000,
});
export const playbackInteractionPolicy = Object.freeze({
	seekStepSeconds: 5,
	playerLoad: "eager" as const,
	playerPreload: "metadata" as const,
});
