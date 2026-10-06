import type {
	CompatibilityCheckRequest,
	CompatibilityInspection,
	CompatibilityResult,
} from "../../shared/media-negotiation.js";
import type { DeepReadonly } from "../../shared/policy.js";
/** User intent and browser evidence are independent of their HTTP encoding. */
export interface PlaybackOptionsRequest {
	fileId: string;
	sourceVersion?: string;
	audioStreamIndices?: number[];
	tryOriginal?: boolean;
	failedResourceIds?: string[];
}
export interface PlaybackOptionsResponse {
	original: CompatibilityInspection;
	candidates: { taskId: string; description: CompatibilityInspection }[];
}
export interface PlaybackSelectionRequest extends PlaybackOptionsRequest {
	original?: CompatibilityCheckRequest;
	candidates: { taskId: string; check: CompatibilityCheckRequest }[];
}
export interface PlaybackSelection {
	sourceVersion: string;
	compatibility: DeepReadonly<CompatibilityResult> | null;
	pending: boolean;
	choice:
		| { kind: "direct"; fileId: string; mimeType: string }
		| { kind: "prepared"; artifactId: string; mimeType: string }
		| { kind: "blocked"; reason: string };
}
export interface PlaybackSelectionApi {
	inspect(input: PlaybackOptionsRequest): Promise<PlaybackOptionsResponse>;
	select(input: PlaybackSelectionRequest): Promise<PlaybackSelection>;
}
