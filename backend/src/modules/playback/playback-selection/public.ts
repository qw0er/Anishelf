import type {
	AssetInspection,
	CompatibilityEvidence,
	MediaAsset,
	PlaybackSource,
} from "../../media/public.js";
/** A listening preference is independent of the tracks retained by preparation. */
export interface PlaybackOptionsRequest {
	fileId: string;
	sourceVersion?: string;
	audioStreamIndex?: number | null;
	assetId?: string;
	allowUnverified?: boolean;
	canSelectAudio: boolean;
	failedResourceIds?: string[];
}
export interface PlaybackOptionsResponse {
	source: PlaybackSource;
	resolvedAudioStreamIndex: number | null;
	assets: AssetInspection[];
	pending: boolean;
}
export interface PlaybackSelectionRequest extends PlaybackOptionsRequest {
	evidence: {
		assetId: string;
		descriptionId: string;
		evidence: CompatibilityEvidence[];
	}[];
}
interface CompatibilityDecision {
	status: "supported" | "unsupported" | "unknown";
	reason: string;
}
export interface AssetCompatibility {
	overall: CompatibilityDecision;
	container: CompatibilityDecision;
	video: CompatibilityDecision;
	audio: CompatibilityDecision;
	warnings: string[];
}
export interface PlaybackAssetChoice {
	asset: MediaAsset;
	audio: AssetInspection["audio"];
	compatibility: AssetCompatibility;
	unavailableReason: string | null;
}
export interface PlaybackSelection {
	source: PlaybackSource;
	resolvedAudioStreamIndex: number | null;
	choices: PlaybackAssetChoice[];
	active: PlaybackAssetChoice | null;
	pending: boolean;
	reason: string | null;
}
export interface PlaybackSelectionApi {
	inspect(input: PlaybackOptionsRequest): Promise<PlaybackOptionsResponse>;
	select(input: PlaybackSelectionRequest): Promise<PlaybackSelection>;
}
