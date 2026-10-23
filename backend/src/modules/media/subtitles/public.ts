export type {
	SubtitleDiscovery,
	SubtitleFonts,
	SubtitlePreparationResult,
} from "./domain/model.js";

import type {
	SubtitleDiscovery,
	SubtitlePreparation,
	SubtitlePreparationResult,
} from "./domain/model.js";
export interface SubtitleApi {
	discoverSubtitles(id: string): Promise<SubtitleDiscovery>;
	prepareSubtitle(
		fileId: string,
		trackId: string,
		sourceVersion: string,
		subtitleVersion?: string,
	): Promise<SubtitlePreparationResult>;
	getSubtitleContent(
		id: string,
		trackId: string,
		sourceVersion: string,
		subtitleVersion: string,
	): Promise<{ text: string }>;
	getSubtitleAssetStatus(id: string): Promise<SubtitlePreparation>;
	getSubtitleAssetContent(id: string): Promise<{ text: string }>;
}
