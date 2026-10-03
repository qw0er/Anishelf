/** Typed execution parameters shared by processing policy and the FFmpeg adapter. */
export interface MediaProcessingProfile {
	id: string;
	container: "mp4";
	fastStart: boolean;
	durationToleranceSeconds: number;
	durationToleranceFrames: number;
	video: {
		encoder: "libx264";
		codec: "h264";
		pixelFormat: "yuv420p";
		crf: number;
		preset: "medium";
		threads: number;
		padToEven: boolean;
		frameRateMode: "passthrough";
		hdrHandling: "reject";
	};
	audio: { encoder: "aac"; codec: "aac"; bitRate: number };
}
export interface MediaProcessingOperation {
	video: "copy" | "encode";
	audio: "copy" | "encode";
}
export interface MediaProcessingPlan {
	profile: MediaProcessingProfile;
	operation: MediaProcessingOperation;
}
