/** Backend execution telemetry. Processing completion still requires output validation. */
export interface MediaExecutionProgress {
	mediaTimeMs: number | null;
	frames: number | null;
	outputBytes: number | null;
	speed: number | null;
	percent: number | null;
	ended: boolean;
}
export type MediaProcessFailureReason =
	| "spawn-failed"
	| "exit-failed"
	| "cancelled"
	| "startup-timeout"
	| "stalled"
	| "timeout"
	| "invalid-progress";
export type MediaProcessEvent =
	| { type: "started"; pid: number }
	| { type: "progress"; progress: MediaExecutionProgress }
	| { type: "stopping"; reason: MediaProcessFailureReason }
	| {
			type: "closed";
			exitCode: number | null;
			signal: string | null;
			reason: MediaProcessFailureReason | null;
	  };
