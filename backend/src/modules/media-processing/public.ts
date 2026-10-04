export type {
	MediaExecutionEvent,
	MediaExecutionHandle,
	MediaExecutionRequest,
	MediaExecutionState,
	MediaProcessingRequest,
	ProcessedMedia,
} from "./application/processing.js";
export {
	MediaProcessingApplication,
	MediaProcessingBusyError,
} from "./application/processing.js";
export type {
	MediaProcessingMode,
	MediaProcessingPolicy,
} from "./domain/policy.js";
export {
	mediaProcessingPolicy,
	resolveMediaProcessingPlan,
	validateMediaProcessingPolicy,
} from "./domain/policy.js";

import type { MediaProcessingApplication } from "./application/processing.js";
export type MediaProcessingApi = Pick<
	MediaProcessingApplication,
	"start" | "process" | "release"
>;
