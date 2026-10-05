export { MediaCompatibilityApplication } from "./application/compatibility.js";
export type {
	CheckedCompatibility,
	CompatibilityInspectInput,
} from "./domain/model.js";

import type { MediaCompatibilityApplication } from "./application/compatibility.js";
export type MediaCompatibilityApi = Pick<
	MediaCompatibilityApplication,
	"inspect" | "check"
>;
