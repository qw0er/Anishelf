export type {
	SubtitleDiscovery,
	SubtitlePreparationResult,
} from "./domain/model.js";

import type { SubtitleApplication } from "./application/subtitles.js";
export type SubtitleApi = Pick<
	SubtitleApplication,
	| "discoverSubtitles"
	| "prepareSubtitle"
	| "getSubtitleContent"
	| "getSubtitleAssetStatus"
	| "getSubtitleAssetContent"
>;

export type { SubtitlePolicy } from "./domain/policy.js";
export { subtitlePolicy, validateSubtitlePolicy } from "./domain/policy.js";
