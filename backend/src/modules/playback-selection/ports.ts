import type {
	CompatibilityCheckRequest,
	CompatibilityInspectInput,
	CompatibilityInspection,
	CompatibilityResult,
} from "../../shared/media-negotiation.js";
import type {
	SourceIdentity,
	SourceReference,
} from "../../shared/media-source.js";
import type { DeepReadonly } from "../../shared/policy.js";
/** Read-only requirements. No planner-private profiles or preparation execution settings. */
export interface PlaybackSelectionPlanning {
	inspect(input: CompatibilityInspectInput): Promise<CompatibilityInspection>;
	check(
		input: CompatibilityCheckRequest & { fileId: string },
	): Promise<DeepReadonly<CompatibilityResult>>;
}
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
export interface PlaybackCopies {
	list(fileId: string): Promise<{ tasks: PlaybackCopy[] }>;
	get(id: string): Promise<PlaybackCopy>;
}
interface SelectionSource {
	identity: SourceIdentity;
	file: { mimeType: string };
	rootEpoch: number;
}
export interface PlaybackSelectionSources {
	resolveSource(id: string, expectedVersion?: string): Promise<SelectionSource>;
	revalidateSource(expected: SourceReference): Promise<unknown>;
	assertRootEpoch(epoch: number): void;
}
