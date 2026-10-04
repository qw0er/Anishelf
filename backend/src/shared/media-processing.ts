/** Explicit execution requirements, independent of compatibility recommendations. */
export type MediaStreamExecution =
	| { action: "copy" }
	| { action: "encode"; encoder: string; codec: string; pixelFormat?: string };
export interface MediaProcessingPlan {
	id: string;
	/** FFmpeg muxer name; no built-in target or encoder preset. */
	container: string;
	/** Expected FFprobe format alias, which can differ from the muxer name. */
	outputFormat: string;
	video: MediaStreamExecution;
	audio: MediaStreamExecution;
	/** Includes explicit and automatically inserted filters required by the adapter. */
	filters: string[];
}
