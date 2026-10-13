export type {
	CompatibilityCheckRequest,
	CompatibilityInspectInput,
	CompatibilityInspection,
	CompatibilityResult,
} from "./media-planning/public.js";

import type { SourceIdentity } from "../../shared/media-source.js";
import type { DeepReadonly } from "../../shared/policy.js";
import type {
	CompatibilityCheckRequest,
	CompatibilityInspectInput,
	CompatibilityInspection,
	CompatibilityResult,
} from "./media-planning/public.js";
export interface PlaybackCopy {
	taskId: string;
	profileId: string;
	source: SourceIdentity;
	audioStreamIndices: readonly number[];
	mode: "remux" | "transcode-audio" | "transcode-video" | "transcode";
	pending: boolean;
	updatedAtMs: number;
	artifact: { id: string; mimeType: string } | null;
	availability: "ready" | "unknown" | "unavailable";
}
export interface MediaApi {
	inspectCompatibility(
		input: CompatibilityInspectInput,
	): Promise<CompatibilityInspection>;
	checkCompatibility(
		input: CompatibilityCheckRequest & { fileId: string },
	): Promise<DeepReadonly<CompatibilityResult>>;
	listPlaybackCopies(fileId: string): Promise<{ tasks: PlaybackCopy[] }>;
	getPlaybackCopy(id: string): Promise<PlaybackCopy>;
}
