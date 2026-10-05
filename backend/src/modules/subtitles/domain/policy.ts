import { subtitleConstraints } from "../../../contracts/defaults.js";
import {
	nativeSubtitleFormats,
	type PreparedSubtitleFormat,
	preparedSubtitleFormats,
	publicSubtitleFormat,
	subtitleExtensionFormats,
	textSubtitleCodecs,
} from "../../../contracts/subtitles.js";
import { subtitleExtractionPolicy } from "../../../platform/media/config.js";
import {
	type DeepReadonly,
	freeze,
	requirePolicy,
	validateNumericPolicy,
} from "../../../shared/policy.js";

const defaults = {
	maximumCacheBytes: 256 * 1024 * 1024,
	maximumBytes: subtitleConstraints.maximumBytes,
	readChunkBytes: 64 * 1024,
	extractionConcurrency: 1,
	extractionTimeoutMs: subtitleExtractionPolicy.extractionTimeoutMs,
	defaultExtractionFormat: "srt" as PreparedSubtitleFormat,
	formats: { ...subtitleExtensionFormats },
	nativeFormats: { ...nativeSubtitleFormats },
	textCodecs: [...textSubtitleCodecs],
};
export type SubtitlePolicy = typeof defaults;
export const subtitlePolicy = freeze(defaults);
export function validateSubtitlePolicy(
	policy: DeepReadonly<SubtitlePolicy>,
): void {
	validateNumericPolicy("subtitles", policy, defaults);
	requirePolicy(
		preparedSubtitleFormats.includes(policy.defaultExtractionFormat) &&
			Object.values(policy.formats).includes(
				publicSubtitleFormat(policy.defaultExtractionFormat),
			),
		"subtitles.defaultExtractionFormat",
	);
	for (const [extension, format] of Object.entries(policy.formats))
		requirePolicy(
			subtitlePolicy.formats[extension] === format,
			`subtitles.formats.${extension}`,
		);
	for (const [codec, format] of Object.entries(policy.nativeFormats))
		requirePolicy(
			subtitlePolicy.nativeFormats[codec] === format,
			`subtitles.nativeFormats.${codec}`,
		);
	for (const codec of policy.textCodecs)
		requirePolicy(
			subtitlePolicy.textCodecs.includes(codec),
			`subtitles.textCodecs.${codec}`,
		);
}

import { type LibraryPolicy, libraryPolicy } from "../../library/policy.js";
export interface SubtitleRuntimePolicy {
	subtitles: SubtitlePolicy;
	library: LibraryPolicy;
}
export const subtitleRuntimePolicy = freeze({
	subtitles: subtitlePolicy,
	library: libraryPolicy,
});
