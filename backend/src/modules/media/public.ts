export type {
	MediaAsset,
	MediaAssetCatalog,
	PlaybackSource,
} from "./assets.js";

import type { MediaAssetCatalog } from "./assets.js";
export interface MediaApi {
	listPlaybackAssets(
		fileId: string,
		sourceVersion?: string,
	): Promise<MediaAssetCatalog>;
}
