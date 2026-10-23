import type { DeepReadonly } from "../../../shared/policy.js";
import type {
	CheckedCompatibility,
	CompatibilityInspectInput,
} from "./domain/model.js";
import type {
	CompatibilityCheckRequest,
	CompatibilityInspection,
} from "./negotiation.js";
import type { MediaPlanningResult } from "./result.js";
export interface MediaPlanningApi {
	plan(
		input: CompatibilityCheckRequest & { fileId: string },
		options?: { forcePreparation: boolean },
	): Promise<DeepReadonly<MediaPlanningResult>>;
	inspect(input: CompatibilityInspectInput): Promise<CompatibilityInspection>;
	check(
		input: CompatibilityCheckRequest & { fileId: string },
	): Promise<DeepReadonly<CheckedCompatibility>>;
}
