import type { Static } from "typebox";
import type {
	TranscodeAudioSchema,
	TranscodeVideoSchema,
} from "../contracts/schemas/transcode-profiles.js";
import type { DeepReadonly } from "./policy.js";
/** Explicit execution requirements, independent of compatibility recommendations. */
export type MediaStreamExecution =
	| { action: "copy" }
	| { action: "encode"; encoder: string; codec: string; pixelFormat?: string };
export interface MediaProcessingPlan {
	id: string;
	/** FFmpeg muxer name; no built-in target or encoder preset. */
	container: string;
	/** Completed file or fragmented MP4 suitable for a future MSE delivery adapter. */
	delivery?: "file" | "media-source";
	/** Expected FFprobe format alias, which can differ from the muxer name. */
	outputFormat: string;
	video: MediaStreamExecution;
	audio: MediaStreamExecution;
	/** Includes explicit and automatically inserted filters required by the adapter. */
	filters: string[];
	/** Typed encoder parameters; no administrator-supplied raw arguments. */
	videoParameters?: Static<typeof TranscodeVideoSchema>;
	audioParameters?: Static<typeof TranscodeAudioSchema>;
	/** Adapter-owned, generated filter expressions. */
	videoFilters?: string[];
	/** Exact H.264 descriptor selected by the preparation resolver. */
	h264Level?: "5.1";
}

/** Immutable work specification shared by planners and execution consumers. */
export interface MediaExecutionSpecification {
	fileId: string;
	sourceVersion: string;
	plan: DeepReadonly<MediaProcessingPlan>;
	videoStreamIndex: number;
	audioStreamIndices: readonly number[];
}
