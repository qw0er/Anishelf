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
	audioStreamIndices: readonly number[];
}
/** Persisted encoding settings. Source identity and plan identity live in their indexed records. */
export interface PreparationSettingsSnapshot {
	version: 1;
	mode: "remux" | "transcode-audio" | "transcode-video" | "transcode";
	reasons: { video: string; audio: string };
	videoStreamIndex: number;
	audioStreamIndices: readonly number[];
	plan: Omit<DeepReadonly<MediaProcessingPlan>, "id">;
}
