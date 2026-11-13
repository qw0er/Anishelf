/** Application-facing clock and lifecycle; values are milliseconds regardless of engine. */
export interface PlaybackClock extends EventTarget {
	currentTimeMs: number;
	readonly durationMs: number;
	readonly playbackRate: number;
	readonly paused: boolean;
	readonly ended: boolean;
	readonly seeking: boolean;
	readonly readyState: number;
	play(): Promise<void>;
}
