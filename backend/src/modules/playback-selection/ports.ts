import type {
	CompatibilityCheckRequest,
	CompatibilityInspection,
} from "../../contracts/http.js";
import type { DeepReadonly } from "../../shared/policy.js";
import type {
	CheckedCompatibility,
	CompatibilityInspectInput,
} from "../media-planning/public.js";
import type { PreparationView } from "../preparation/public.js";
/** Read-only requirements: selecting playback can never create or retry work. */
export interface PlaybackSelectionPlanning {
	inspect(input: CompatibilityInspectInput): Promise<CompatibilityInspection>;
	check(
		input: CompatibilityCheckRequest & { fileId: string },
	): Promise<DeepReadonly<CheckedCompatibility>>;
}
export interface PlaybackCopies {
	list(fileId: string): Promise<{ tasks: PreparationView[] }>;
	get(id: string): Promise<PreparationView>;
}

export interface PlaybackSelectionSources {
	resolveSource(
		id: string,
		expectedVersion?: string,
	): Promise<import("../resource-access/public.js").ResolvedSource>;
	revalidateSource(
		expected: import("../resource-access/public.js").SourceReference,
	): Promise<import("../resource-access/public.js").ResolvedSource>;
	assertRootEpoch(epoch: number): void;
}
