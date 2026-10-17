import type { DeepReadonly } from "../../../../shared/policy.js";
import type { TranscodeProfile } from "../../../system/public.js";
import type {
	CompatibilityInspection,
	CompatibilityResult,
} from "../negotiation.js";

export type { CompatibilityInspectInput } from "../negotiation.js";
export type CompatibilityOutput = NonNullable<
	CompatibilityInspection["output"]
>;
/** Planning-only context never belongs to a consumer's compatibility report. */
export interface CheckedCompatibility extends CompatibilityResult {
	scopeId: string;
	profile: DeepReadonly<TranscodeProfile> | null;
}
export type OriginalMediaDescription = Omit<
	CompatibilityInspection,
	"descriptionId" | "output"
>;
