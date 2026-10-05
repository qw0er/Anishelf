import type { DerivedMediaIdentity } from "../../../shared/media-preparation.js";

export type { DerivedMediaIdentity } from "../../../shared/media-preparation.js";

import type { MediaExecutionRequest } from "../../media-processing/public.js";

/** Public decisions contain no filesystem paths or executable encoder settings. */
export type PlaybackPlan =
	| { mode: "direct"; playbackUrl: string }
	| { mode: "prepared"; artifactId: string; playbackUrl: string }
	| { mode: "preparing"; taskId: string }
	| {
			mode: "realtime";
			sessionId: string;
			playbackUrl: string;
			generation: number;
	  }
	| { mode: "blocked"; reason: string };

/** A plan needing work is not a queued task, published artifact or live session. */
export type PlaybackPlanningResult =
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
	playbackUrl: string;
}

/** The real-time owner controls children/segments; this generation is not history's generation. */
export interface RealtimePlaybackResource {
	sessionId: string;
	identity: DerivedMediaIdentity;
	playbackUrl: string;
	generation: number;
	sourceStartMs: number;
}

export function directPlaybackPlan(
	fileId: string,
): Extract<PlaybackPlan, { mode: "direct" }> {
	return {
		mode: "direct",
		playbackUrl: `/api/media/${encodeURIComponent(fileId)}`,
	};
}
