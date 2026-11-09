import type {
	AudioEncoding,
	EncodingOptions,
	VideoEncoding,
} from "./encoding.js";

/** Explicit execution requirements, independent of compatibility recommendations. */
type MediaStreamExecution =
	| { action: "copy" }
	| {
			action: "encode";
			encoder: string;
			codec: string;
			pixelFormat?: string | undefined;
	  };
export interface MediaProcessingPlan {
	id: string;
	compilerVersion?: 2;
	globalOptions?: EncodingOptions | undefined;
	inputOptions?: EncodingOptions | undefined;
	muxerOptions?: EncodingOptions | undefined;
	audioTracks?: {
		sourceIndex: number;
		execution: MediaStreamExecution;
		parameters?: AudioEncoding;
		default?: boolean;
	}[];
	acceptance?: import("../../shared/policy.js").DeepReadonly<
		NonNullable<
			import("../../contracts/auto-preparation.js").AutoPreparationPreset["accept"]
		>
	>;
	/** FFmpeg muxer name; no built-in target or encoder preset. */
	container: string;
	/** Completed file or fragmented MP4 suitable for a future MSE delivery adapter. */
	delivery?: "file" | "media-source";
	/** Expected FFprobe format alias, which can differ from the muxer name. */
	outputFormat: string;
	video: MediaStreamExecution;
	audio: MediaStreamExecution;
	/** Includes explicit and automatically inserted filters required by the adapter. */
	filters: string[];
	/** Typed encoder parameters; no administrator-supplied raw arguments. */
	videoParameters?: VideoEncoding;
	audioParameters?: AudioEncoding;
	/** Adapter-owned, generated filter expressions. */
	videoFilters?: string[];
	/** Exact H.264 descriptor selected by the preparation resolver. */
	h264Level?: "5.1";
}
