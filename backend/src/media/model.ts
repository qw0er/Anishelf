export interface MediaStream {
	index: number;
	type: string;
	codec: string | null;
	profile: string | null;
	width: number | null;
	height: number | null;
	pixelFormat: string | null;
	frameRate: string | null;
	sampleRate: number | null;
	channels: number | null;
	channelLayout: string | null;
	duration: number | null;
	bitRate: number | null;
	tags: Readonly<Record<string, string>>;
	default: boolean;
	forced: boolean;
}

export interface MediaInfo {
	format: string | null;
	duration: number | null;
	size: number | null;
	bitRate: number | null;
	tags: Readonly<Record<string, string>>;
	streams: MediaStream[];
}

export type SubtitleFormat = "srt" | "ass" | "webvtt";
export interface ExtractedSubtitle {
	streamIndex: number;
	format: SubtitleFormat;
	/** UTF-8 text. The caller owns persistence and access control. */
	text: string;
}

export type ToolStatus =
	| { available: true; path: string; version: string }
	| { available: false; message: string };
