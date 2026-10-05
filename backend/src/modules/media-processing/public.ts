export type {
	MediaExecutionAdapter,
	MediaExecutionEvent,
	MediaExecutionHandle,
	MediaExecutionRequest,
	MediaExecutionState,
	ProcessedHlsMedia,
	ProcessedMedia,
	ProcessedOutput,
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
	"start" | "release" | "initialize"
>;

export type {
	HlsExecutionPlan,
	HlsExecutionRequest,
} from "../../shared/media-processing.js";
export type { PreparationExecutionPlan } from "./application/execution-plan.js";
export { resolveExecutionPlan } from "./application/execution-plan.js";
export type { HlsPlanningResult } from "./application/hls-execution-plan.js";
export { resolveHlsExecutionPlan } from "./application/hls-execution-plan.js";
