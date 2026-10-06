import type { Static } from "typebox";
import type {
	TranscodeAudioSchema,
	TranscodeVideoSchema,
} from "../../../contracts/schemas/transcode-profiles.js";
import type { MediaStreamExecution } from "../../../shared/media-processing.js";
import type { DeepReadonly } from "../../../shared/policy.js";
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
