import {
	nativeSubtitleFormats,
	type PreparedSubtitleFormat,
	textSubtitleCodecs,
} from "../../contracts/subtitles.js";
import { freeze } from "../../shared/policy.js";
export interface MediaToolsConfig {
	ffmpegPath: string;
	ffprobePath: string;
}
/** Only extraction inputs used by the adapter; no subtitle workflow policy. */
export interface SubtitleExtractionPolicy {
	extractionTimeoutMs: number;
	nativeFormats: Readonly<Record<string, PreparedSubtitleFormat>>;
	textCodecs: readonly string[];
}
export const subtitleExtractionPolicy = freeze({
	extractionTimeoutMs: 60000,
	nativeFormats: nativeSubtitleFormats,
	textCodecs: textSubtitleCodecs,
});
