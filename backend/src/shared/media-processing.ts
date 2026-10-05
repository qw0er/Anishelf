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

export interface HlsAudioExecution {
	sourceStreamIndex: number;
	trackId: string;
	execution: MediaStreamExecution;
	parameters?: Static<typeof TranscodeAudioSchema>;
	reason: string;
}
/** HLS is a delivery format, not an elementary-stream container or a live session. */
export interface HlsExecutionPlan {
	id: string;
	delivery: "hls";
	segmentContainer: "fmp4";
	packagingVersion: "hls:1";
	/** A target, not a promise of exact cuts when video is copied. */
	targetSegmentDurationMs: number;
	videoStreamIndex: number;
	video: MediaStreamExecution;
	videoParameters?: Static<typeof TranscodeVideoSchema>;
	videoFilters: string[];
	h264Level?: "5.1";
	videoReason: string;
	audioTracks: HlsAudioExecution[];
	filters: string[];
}
export interface HlsExecutionRequest {
	fileId: string;
	sourceVersion: string;
	plan: DeepReadonly<HlsExecutionPlan>;
	/** Source position is independent of segment numbering and history generation. */
	sourceStartMs: number;
}
