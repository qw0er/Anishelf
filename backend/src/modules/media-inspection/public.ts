import type { MediaInspectionApplication } from "./application/inspection.js";

export type { MediaInspectionResult } from "./application/inspection.js";
export { MediaInspectionBusyError } from "./application/inspection.js";
export type MediaInspectionApi = Pick<MediaInspectionApplication, "inspect">;

export type { MediaInspectionPolicy } from "./domain/policy.js";
export {
	mediaInspectionPolicy,
	validateMediaInspectionPolicy,
} from "./domain/policy.js";
