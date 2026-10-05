import type {
	CompatibilityInspection,
	CompatibilityResult,
} from "../../../contracts/http.js";
import type { DeepReadonly } from "../../../shared/policy.js";
import type { TranscodeProfile } from "../../../shared/transcode-profiles.js";

export type CompatibilityOutput = NonNullable<
	CompatibilityInspection["output"]
>;
export interface CompatibilityInspectInput {
	fileId: string;
	sourceVersion?: string;
	audioStreamIndices?: number[];
	output?: Pick<CompatibilityOutput, "profileId" | "target"> | null;
}
/** Internal snapshot. The presenter removes source paths and executable profile definitions. */
export interface CheckedCompatibility extends CompatibilityResult {
	canonicalRoot: string;
	profile: DeepReadonly<TranscodeProfile> | null;
}
export type OriginalMediaDescription = Omit<
	CompatibilityInspection,
	"descriptionId" | "output"
>;
