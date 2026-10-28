import type { MediaStream } from "../../../platform/media/model.js";

interface StreamIdentity {
	index: number;
	codec: string | null;
	codecString: string | null;
	profile: string | null;
	bitrate: number | null;
	language?: string | null;
	label?: string | null;
	default?: boolean;
}
export interface MediaVideoDescription extends StreamIdentity {
	kind: "video";
	pixelFormat: string | null;
	bitDepth: number | null;
	hdr: boolean;
	width: number | null;
	height: number | null;
	frameRate: number | null;
}
export interface MediaAudioDescription extends StreamIdentity {
	kind: "audio";
	sampleRate: number | null;
	channels: number | null;
}

export function describeVideo(stream: MediaStream): MediaVideoDescription {
	return {
		...describeCommon(stream),
		kind: "video",
		pixelFormat: stream.pixelFormat,
		bitDepth: stream.bitDepth,
		hdr: stream.hdr.pq || stream.hdr.hlg || stream.hdr.sideDataTypes.length > 0,
		width: stream.width,
		height: stream.height,
		frameRate: stream.framesPerSecond,
	};
}
export function describeAudio(stream: MediaStream): MediaAudioDescription {
	return {
		...describeCommon(stream),
		kind: "audio",
		sampleRate: stream.sampleRate,
		channels: stream.channels,
	};
}
function describeCommon(stream: MediaStream) {
	return {
		index: stream.index,
		codec: stream.codec,
		codecString: stream.codecString ?? null,
		profile: stream.profile,
		bitrate: stream.bitRate,
		language: stream.tags.language?.slice(0, 256) ?? null,
		label: stream.tags.title?.slice(0, 256) ?? null,
		default: stream.default,
	};
}
