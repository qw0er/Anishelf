import type { MediaProcessingPlan } from "./media-processing.js";
import type { DeepReadonly } from "./policy.js";

/** Version-bound derived media identity shared by planning and persistent output owners. */
export interface DerivedMediaIdentity {
	rootId: string;
	fileId: string;
	sourceVersion: string;
	profileFingerprint: string;
	executionPlanId: string;
	videoStreamIndex: number;
	audioStreamIndex: number | null;
}
/** Trusted snapshot produced by planning; excludes callbacks, cancellation and browser reports. */
export interface MediaPreparationSnapshot {
	identity: DerivedMediaIdentity;
	mode: "remux" | "transcode-audio" | "transcode-video" | "transcode";
	reasons: { video: string; audio: string };
	request: {
		fileId: string;
		sourceVersion: string;
		plan: DeepReadonly<MediaProcessingPlan>;
		videoStreamIndex: number;
		audioStreamIndex: number | null;
	};
}
