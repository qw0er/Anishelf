import type {
	ExtractedSubtitle,
	SubtitleFormat,
} from "../../platform/media/model.js";
/** Consumer-owned extraction capability; no dependency on the concrete tool service. */
export interface SubtitleExtractor {
	extractSubtitle(
		path: string,
		streamIndex: number,
		options?: { format?: SubtitleFormat; signal?: AbortSignal },
	): Promise<ExtractedSubtitle>;
}
