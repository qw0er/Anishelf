import type { MediaAssetCatalog } from "../../media/public.js";
export interface PlaybackAssets {
	list(fileId: string, sourceVersion?: string): Promise<MediaAssetCatalog>;
}
