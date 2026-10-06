import type { CompatibilityCheckRequest } from "../../contracts/http.js";
import type { DeepReadonly } from "../../shared/policy.js";
import type { MediaPlanningResult } from "../media-planning/public.js";

/** Preparation only requires a read-only, source-bound planning decision. */
export interface PreparationPlanner {
	plan(
		input: CompatibilityCheckRequest & { fileId: string },
	): Promise<DeepReadonly<MediaPlanningResult>>;
}
