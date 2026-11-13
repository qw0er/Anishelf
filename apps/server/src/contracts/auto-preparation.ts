type ViewingState = "unwatched" | "in-progress" | "completed";
export interface VideoAcceptance {
	codecs?: string[];
	pixelFormats?: string[];
	profiles?: string[];
	maxLevel?: string | null;
	maxWidth?: number | null;
	maxHeight?: number | null;
	maxFrameRate?: number | null;
	maxBitrateKbps?: number | null;
	dynamicRanges?: ("sdr" | "hdr10" | "hlg")[];
}
export interface AudioAcceptance {
	codecs?: string[];
	profiles?: string[];
	maxChannels?: number | null;
	sampleRates?: number[];
	maxBitrateKbps?: number | null;
}
export interface AutoPreparationPreset {
	id: string;
	name: string;
	description?: string;
	match?: {
		rootIds?: string[];
		include?: string[];
		exclude?: string[];
		viewingStates?: ViewingState[];
	};
	audio?: {
		selection?: "all" | "default" | "languages" | "none";
		languages?: string[];
		fallback?: "default" | "all" | "skip";
	};
	accept?: {
		containers?: string[];
		video?: VideoAcceptance[];
		audio?: AudioAcceptance[];
	};
	transcodeProfileId: string;
}
