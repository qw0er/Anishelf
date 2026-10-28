import type { MediaTimeline } from "../../../contracts/media.js";
import type {
	MediaAudioDescription,
	MediaVideoDescription,
} from "../media-inspection/public.js";
import type { CompatibilityQuery } from "../media-planning/public.js";

/** A versioned description of bytes that already exist, never an encoding prediction. */
export interface MediaAsset {
	id: string;
	revision: string;
	kind: "original" | "prepared";
	inspection: "complete" | "unavailable";
	profileId: string | null;
	container: string | null;
	video: MediaVideoDescription | null;
	audioTracks: { stream: MediaAudioDescription; sourceStreamIndex: number }[];
	defaultAudioStreamIndex: number | null;
	durationMs: number | null;
	sizeBytes: number;
	mimeType: string;
	timeline: MediaTimeline;
}
export interface PlaybackSource {
	fileId: string;
	sourceVersion: string;
	audioTracks: MediaAudioDescription[];
	defaultAudioStreamIndex: number | null;
}
export interface MediaAssetCatalog {
	source: PlaybackSource;
	assets: MediaAsset[];
	pendingAudioSelections: number[][];
}
export interface MediaAssetCatalogApi {
	list(fileId: string, sourceVersion?: string): Promise<MediaAssetCatalog>;
}
export interface AssetInspection {
	asset: MediaAsset;
	descriptionId: string;
	audio: {
		streamIndex: number;
		sourceStreamIndex: number;
		position: number;
	} | null;
	queries: CompatibilityQuery[];
}
