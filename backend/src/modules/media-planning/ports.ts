import type {
	CompatibilityCheckRequest,
	CompatibilityInspection,
} from "../../contracts/http.js";
import type { DeepReadonly } from "../../shared/policy.js";
import type {
	CheckedCompatibility,
	CompatibilityInspectInput,
} from "./domain/model.js";
import type { MediaPlanningResult } from "./domain/plan.js";
export interface MediaPlanningApi {
	plan(
		input: CompatibilityCheckRequest & { fileId: string },
	): Promise<DeepReadonly<MediaPlanningResult>>;
	inspect(input: CompatibilityInspectInput): Promise<CompatibilityInspection>;
	check(
		input: CompatibilityCheckRequest & { fileId: string },
	): Promise<DeepReadonly<CheckedCompatibility>>;
}
