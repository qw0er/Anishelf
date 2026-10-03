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
	bitRate: number | null;
	tags: Readonly<Record<string, string>>;
	default: boolean;
	forced: boolean;
}

/** Unversioned tool output. Consume with MediaInspectionResult.source.identity.sourceVersion. */
export interface MediaInfo {
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

export type { PreparedSubtitleFormat as SubtitleFormat } from "../../contracts/subtitles.js";

import type { PreparedSubtitleFormat as SubtitleFormat } from "../../contracts/subtitles.js";
export interface ExtractedSubtitle {
	streamIndex: number;
	format: SubtitleFormat;
	/** UTF-8 text. The caller owns persistence and access control. */
	text: string;
}

export type ToolStatus =
	| { available: true; path: string; version: string }
	| { available: false; message: string };
