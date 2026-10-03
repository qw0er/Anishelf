export type { MediaProcessingMode } from "../../platform/media/index.js";
export type {
	MediaProcessingRequest,
	ProcessedMedia,
} from "./application/processing.js";
export {
	MediaProcessingApplication,
	MediaProcessingBusyError,
} from "./application/processing.js";

import type { MediaProcessingApplication } from "./application/processing.js";
export type MediaProcessingApi = Pick<
	MediaProcessingApplication,
	"process" | "release"
>;
