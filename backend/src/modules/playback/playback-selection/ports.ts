import type {
	SourceIdentity,
	SourceReference,
} from "../../../shared/media-source.js";
import type { DeepReadonly } from "../../../shared/policy.js";
import type {
	CompatibilityCheckRequest,
	CompatibilityInspectInput,
	CompatibilityInspection,
	CompatibilityResult,
} from "../../media/public.js";
/** Read-only requirements. No planner-private profiles or preparation execution settings. */
export interface PlaybackSelectionPlanning {
	inspect(input: CompatibilityInspectInput): Promise<CompatibilityInspection>;
	check(
		input: CompatibilityCheckRequest & { fileId: string },
	): Promise<DeepReadonly<CompatibilityResult>>;
}
export type { PlaybackCopy } from "../../media/public.js";

import type { PlaybackCopy } from "../../media/public.js";
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
