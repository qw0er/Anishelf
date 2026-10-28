export type {
	AssetInspection,
	MediaAsset,
	MediaAssetCatalog,
	PlaybackSource,
} from "./media-assets/public.js";
export type {
	CompatibilityEvidence,
	CompatibilityQuery,
	CompatibilityResult,
} from "./media-planning/public.js";

import type { MediaAssetCatalog } from "./media-assets/public.js";
export interface MediaApi {
	listPlaybackAssets(
		fileId: string,
		sourceVersion?: string,
	): Promise<MediaAssetCatalog>;
}
