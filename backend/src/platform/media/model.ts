export type MediaContainer = "mp4" | "quicktime" | "matroska" | "webm";

export interface HdrSideData {
	type: string;
	/** Whitelisted FFprobe scalar values; chromaticities/luminance retain rational strings. */
	values: Readonly<Record<string, number | string>>;
}

export interface MediaStream {
	index: number;
	type: string;
	codec: string | null;
	/** Exact codec descriptor from bounded initialization data; absent means unknown. */
	codecString?: string | null;
	codecTag?: string | null;
	profile: string | null;
	level: number | null;
	/** Raw sample depth, otherwise maximum pixel component depth; never bits per pixel. */
	bitDepth: number | null;
	colorRange: string | null;
	colorSpace: string | null;
	colorTransfer: string | null;
	colorPrimaries: string | null;
	/** Reported HDR signals; absence does not establish SDR. */
	hdr: {
		pq: boolean;
		hlg: boolean;
		sideDataTypes: string[];
		sideData: HdrSideData[];
	};
	attachedPicture: boolean;
	width: number | null;
	height: number | null;
	pixelFormat: string | null;
	frameRate: string | null;
	framesPerSecond: number | null;
	sampleRate: number | null;
	channels: number | null;
	channelLayout: string | null;
	duration: number | null;
	startTime?: number | null;
	bitRate: number | null;
	tags: Readonly<Record<string, string>>;
	default: boolean;
	forced: boolean;
}

interface MediaChapter {
	title: string | null;
	startMs: number;
	endMs: number;
}

/** Unversioned tool output. Consume with MediaInspectionResult.source.identity.sourceVersion. */
export interface MediaInfo {
	chapters: MediaChapter[];
	/** Raw FFprobe demuxer names, retained for diagnostics. */
	format: string | null;
	formatAliases: string[];
	/** Content signature, never inferred from the filename. */
	container: MediaContainer | null;
	duration: number | null;
	size: number | null;
	bitRate: number | null;
	tags: Readonly<Record<string, string>>;
	streams: MediaStream[];
}

import type { DeepReadonly } from "../../shared/policy.js";
import type { MediaProcessingPlan } from "./specification.js";

export interface MediaProcessingOptions {
	onEvent?: (event: import("./events.js").MediaProcessEvent) => void;
	plan: DeepReadonly<MediaProcessingPlan>;
	videoStreamIndex: number;
	/** An empty selection explicitly produces video-only output. */
	audioStreamIndices: readonly number[];
	signal?: AbortSignal;
	/** Maximum bytes the execution may write to its output file. */
	maximumBytes: number;
	timeoutMs: number;
}

export type ToolStatus =
	| { available: true; path: string; version: string }
	| { available: false; message: string };
