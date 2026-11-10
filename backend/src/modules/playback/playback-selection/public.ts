import type { MediaAsset, PlaybackSource } from "../../media/public.js";
export interface PlaybackOptionsRequest {
	fileId: string;
	sourceVersion?: string;
	audioStreamIndex?: number | null;
	assetId?: string;
}
interface AssetAudio {
	streamIndex: number;
	sourceStreamIndex: number;
	position: number;
}
export interface PlaybackOptionsResponse {
	source: PlaybackSource;
	resolvedAudioStreamIndex: number | null;
	assets: { asset: MediaAsset; audio: AssetAudio | null }[];
}
export type PlaybackSelectionRequest = PlaybackOptionsRequest;
interface PlaybackAssetChoice {
	asset: MediaAsset;
	audio: AssetAudio | null;
	unavailableReason: string | null;
}
export interface PlaybackSelection {
	source: PlaybackSource;
	resolvedAudioStreamIndex: number | null;
	choices: PlaybackAssetChoice[];
	active: PlaybackAssetChoice | null;
	reason: string | null;
}
export interface PlaybackSelectionApi {
	inspect(input: PlaybackOptionsRequest): Promise<PlaybackOptionsResponse>;
	select(input: PlaybackSelectionRequest): Promise<PlaybackSelection>;
}
