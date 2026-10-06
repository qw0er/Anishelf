import type {
	CompatibilityInspection,
	CompatibilityResult,
} from "../../../shared/media-negotiation.js";
import type { DeepReadonly } from "../../../shared/policy.js";
import type { TranscodeProfile } from "../../../shared/transcode-profiles.js";

export type { CompatibilityInspectInput } from "../../../shared/media-negotiation.js";
export type CompatibilityOutput = NonNullable<
	CompatibilityInspection["output"]
>;
/** Planning-only context never belongs to a consumer's compatibility report. */
export interface CheckedCompatibility extends CompatibilityResult {
	canonicalRoot: string;
	profile: DeepReadonly<TranscodeProfile> | null;
}
export type OriginalMediaDescription = Omit<
	CompatibilityInspection,
	"descriptionId" | "output"
>;
