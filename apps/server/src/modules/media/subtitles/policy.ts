import { subtitleConstraints } from "@anishelf/contracts/defaults";
import { subtitleExtensionFormats } from "@anishelf/contracts/subtitles";
import {
	type DeepReadonly,
	freeze,
	requirePolicy,
	validateNumericPolicy,
} from "../../../shared/policy.js";
import {
	defaultSortingPolicy,
	type SortingPolicy,
} from "../../../shared/sorting.js";

const defaults = {
	maximumBytes: subtitleConstraints.maximumBytes,
	readChunkBytes: 64 * 1024,
	formats: { ...subtitleExtensionFormats },
};
export type SubtitlePolicy = typeof defaults;
export const subtitlePolicy = freeze(defaults);
export function validateSubtitlePolicy(
	policy: DeepReadonly<SubtitlePolicy>,
): void {
	validateNumericPolicy("subtitles", policy, defaults);
	for (const [extension, format] of Object.entries(policy.formats))
		requirePolicy(
			subtitlePolicy.formats[extension] === format,
			`subtitles.formats.${extension}`,
		);
}
export interface SubtitleRuntimePolicy {
	subtitles: SubtitlePolicy;
	library: SortingPolicy;
}
export const subtitleRuntimePolicy = freeze({
	subtitles: subtitlePolicy,
	library: defaultSortingPolicy,
});
