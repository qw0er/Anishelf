export type {
	MediaExecutionAdapter,
	MediaExecutionEvent,
	MediaExecutionHandle,
	MediaExecutionRequest,
	MediaExecutionState,
	ProcessedMedia,
} from "./application/processing.js";
export {
	MediaProcessingApplication,
	MediaProcessingBusyError,
} from "./application/processing.js";
export type { MediaProcessingPolicy } from "./domain/policy.js";
export {
	mediaProcessingPolicy,
	validateMediaProcessingPolicy,
} from "./domain/policy.js";

import type { MediaProcessingApplication } from "./application/processing.js";
export type MediaProcessingApi = Pick<
	MediaProcessingApplication,
	"start" | "release"
>;

export type { PreparationExecutionPlan } from "./application/execution-plan.js";
export { resolveExecutionPlan } from "./application/execution-plan.js";
