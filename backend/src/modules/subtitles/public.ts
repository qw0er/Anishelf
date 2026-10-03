export type { SubtitleDiscovery, SubtitlePreparation } from "./domain/model.js";

import type { SubtitleApplication } from "./application/subtitles.js";
export type SubtitleApi = Pick<
	SubtitleApplication,
	| "discoverSubtitles"
	| "prepareSubtitle"
	| "getSubtitleContent"
	| "getSubtitleAssetStatus"
	| "getSubtitleAssetContent"
>;
