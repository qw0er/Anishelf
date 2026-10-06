import type { DerivedMediaIdentity } from "../../../shared/media-preparation.js";
import type { MediaExecutionRequest } from "../../media-processing/public.js";
/** A plan needing work is not a queued task, published artifact or live session. */
export type MediaPlanningResult =
	| { kind: "playable"; fileId: string; mimeType: string }
	| { kind: "blocked"; reason: string }
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
