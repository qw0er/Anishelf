import type {
	CompatibilityAudioStream,
	CompatibilityVideoStream,
} from "../../../contracts/http.js";
import type { MediaStream } from "../../../platform/media/index.js";
export function describeVideo(stream: MediaStream): CompatibilityVideoStream {
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
export function describeAudio(stream: MediaStream): CompatibilityAudioStream {
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
