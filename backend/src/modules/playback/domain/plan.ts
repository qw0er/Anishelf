import type { DerivedMediaIdentity } from "../../../shared/media-preparation.js";

export type { DerivedMediaIdentity } from "../../../shared/media-preparation.js";

import type {
	HlsPlaybackResource,
	PlaybackPlanDto,
	PlaybackResource,
} from "../../../contracts/http.js";
import { originalTimeline } from "../../../contracts/media.js";
import type { HlsExecutionRequest } from "../../../shared/media-processing.js";
import type { MediaExecutionRequest } from "../../media-processing/public.js";

/** Public decisions contain resource references, never paths or encoder settings. */
export type PlaybackPlan = PlaybackPlanDto;

/** A plan needing work is not a queued task, published artifact or live session. */
export type PlaybackPlanningResult =
	| {
			kind: "hls-required";
			identity: DerivedMediaIdentity;
			execution: HlsExecutionRequest;
	  }
	| { kind: "playable"; plan: Extract<PlaybackPlan, { mode: "direct" }> }
	| { kind: "blocked"; plan: Extract<PlaybackPlan, { mode: "blocked" }> }
	| {
			kind: "processing-required";
			target: "file" | "media-source";
			mode: "remux" | "transcode-audio" | "transcode-video" | "transcode";
			reasons: { video: string; audio: string };
			identity: DerivedMediaIdentity;
			/** Private request; transport must never serialize this result directly. */
			execution: Omit<
				MediaExecutionRequest,
				"signal" | "onEvent" | "maximumBytes"
			>;
	  };

/** Preparation owns publication/deletion; playback only borrows ready artifacts. */
export interface PreparedPlaybackResource {
	artifactId: string;
	identity: DerivedMediaIdentity;
	resource: PlaybackResource;
}

/** The real-time owner controls children/segments; this generation is not history's generation. */
export interface RealtimePlaybackResource {
	sessionId: string;
	identity: DerivedMediaIdentity;
	resource: HlsPlaybackResource;
	streamGeneration: number;
}

export function directPlaybackPlan(
	fileId: string,
	mimeType = "application/octet-stream",
): Extract<PlaybackPlan, { mode: "direct" }> {
	return {
		mode: "direct",
		resource: {
			delivery: "file",
			url: `/api/media/${encodeURIComponent(fileId)}`,
			mimeType,
			timeline: originalTimeline(),
		},
	};
}
