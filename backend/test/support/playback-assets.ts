import type {
	MediaAsset,
	MediaAssetCatalog,
} from "../../src/modules/media/public.js";
export const fileId = "a".repeat(64);
export const copyId = "b".repeat(64);
export function audio(index: number, language = "jpn", codec = "opus") {
	return {
		kind: "audio" as const,
		index,
		codec,
		codecString: codec === "aac" ? "mp4a.40.2" : "opus",
		profile: null,
		bitrate: 192000,
		sampleRate: 48000,
		channels: 2,
		language,
		label: null,
		default: true,
	};
}
export function asset(id = copyId): MediaAsset {
	return {
		id,
		revision: "d".repeat(64),
		kind: "prepared",
		inspection: "complete",
		profileId: "builtin:balanced",
		container: "mp4",
		video: {
			kind: "video",
			index: 0,
			codec: "h264",
			codecString: "avc1.640033",
			profile: "High",
			bitrate: 2000000,
			pixelFormat: "yuv420p",
			bitDepth: 8,
			hdr: false,
			width: 1920,
			height: 1080,
			frameRate: 24,
		},
		audioTracks: [{ stream: audio(1, "jpn", "aac"), sourceStreamIndex: 1 }],
		defaultAudioStreamIndex: 1,
		durationMs: 60000,
		sizeBytes: 1000000,
		mimeType: "video/mp4",
		timeline: { sourceOriginMs: 0, mediaOriginMs: 0, sourceDurationMs: 60000 },
	};
}
export function catalog(): MediaAssetCatalog {
	const original: MediaAsset = {
		...asset(fileId),
		kind: "original",
		profileId: null,
		container: "matroska",
		mimeType: "video/x-matroska",
		audioTracks: [
			{ stream: audio(1), sourceStreamIndex: 1 },
			{ stream: audio(2, "eng"), sourceStreamIndex: 2 },
		],
	};
	return {
		source: {
			fileId,
			sourceVersion: "version",
			audioTracks: [audio(1), audio(2, "eng")],
			defaultAudioStreamIndex: 1,
		},
		assets: [original, asset()],
		pendingAudioSelections: [],
	};
}
