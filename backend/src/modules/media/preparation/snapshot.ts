import type { MediaProcessingPlan } from "../../../platform/media/specification.js";
import type { DeepReadonly } from "../../../shared/policy.js";

/** Persisted encoding settings. Source identity and plan identity live in their indexed records. */
export interface PreparationSettingsSnapshot {
	version: 1 | 2;
	mode: "remux" | "transcode-audio" | "transcode-video" | "transcode";
	reasons: { video: string; audio: string };
	videoStreamIndex: number;
	audioStreamIndices: readonly number[];
	plan: Omit<DeepReadonly<MediaProcessingPlan>, "id">;
	automaticPreset?: DeepReadonly<
		import("../../../contracts/auto-preparation.js").AutoPreparationPreset
	>;
}

export interface PreparationDemand {
	origin: "manual" | "automatic";
	presetId?: string;
	presetFingerprint?: string;
	presetSnapshot?: DeepReadonly<
		import("../../../contracts/auto-preparation.js").AutoPreparationPreset
	>;
}
export interface AutomaticDemandRecord {
	id: string;
	failures: number;
	nextAttemptAtMs: number;
	taskUpdatedAtMs?: number;
}
