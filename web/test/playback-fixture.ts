export function required<T>(value: T | null | undefined): T {
	if (value === null || value === undefined)
		throw new Error("Missing fixture value");
	return value;
}

import type {
	ActivePlayback,
	AssetCompatibility,
	MediaAsset,
	PlaybackOptionsResponse,
	PlaybackSelectionResponse,
	PlaybackSource,
} from "../src/shared/api/contracts.js";
export const source: PlaybackSource = {
	fileId: "file",
	sourceVersion: "v1",
	defaultAudioStreamIndex: 1,
	audioTracks: [
		{
			kind: "audio",
			index: 1,
			codec: "opus",
			codecString: "opus",
			profile: null,
			bitrate: 128000,
			sampleRate: 48000,
			channels: 2,
			language: "jpn",
			default: true,
		},
		{
			kind: "audio",
			index: 2,
			codec: "opus",
			codecString: "opus",
			profile: null,
			bitrate: 128000,
			sampleRate: 48000,
			channels: 2,
			language: "eng",
		},
	],
};
export const preparedAsset: MediaAsset = {
	id: "artifact",
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
		width: 1920,
		height: 1080,
		pixelFormat: "yuv420p",
		bitDepth: 8,
		hdr: false,
		frameRate: 24,
	},
	audioTracks: [
		{
			stream: {
				...required(source.audioTracks[0]),
				codec: "aac",
				codecString: "mp4a.40.2",
			},
			sourceStreamIndex: 1,
		},
	],
	defaultAudioStreamIndex: 1,
	durationMs: 60000,
	sizeBytes: 1000000,
	mimeType: "video/mp4",
	timeline: { sourceOriginMs: 0, mediaOriginMs: 0, sourceDurationMs: 60000 },
};
export const originalAsset: MediaAsset = {
	...preparedAsset,
	id: "file",
	kind: "original",
	profileId: null,
	container: "matroska",
	mimeType: "video/x-matroska",
	video: {
		...required(preparedAsset.video),
		codec: "av1",
		codecString: "av01.0.08M.08",
	},
	audioTracks: source.audioTracks.map((stream) => ({
		stream,
		sourceStreamIndex: stream.index,
	})),
};
const supported = { status: "supported" as const, reason: "browser-supported" };
export const compatibility: AssetCompatibility = {
	overall: supported,
	container: supported,
	video: supported,
	audio: supported,
	warnings: [],
};
export const originalChoice = {
	asset: originalAsset,
	audio: { streamIndex: 1, sourceStreamIndex: 1, position: 0 },
	compatibility: {
		...compatibility,
		overall: {
			status: "unknown" as const,
			reason: "native-track-selection-uncertain",
		},
	},
	unavailableReason: "native-track-selection-uncertain",
};
export const preparedChoice = {
	asset: preparedAsset,
	audio: { streamIndex: 1, sourceStreamIndex: 1, position: 0 },
	compatibility,
	unavailableReason: null,
};
export const preparedActive: ActivePlayback = {
	...preparedChoice,
	resource: {
		delivery: "file",
		url: "/api/prepared-media/artifact",
		mimeType: "video/mp4",
		timeline: preparedAsset.timeline,
	},
};
export const originalActive: ActivePlayback = {
	...originalChoice,
	resource: {
		delivery: "file",
		url: "/api/media/file",
		mimeType: originalAsset.mimeType,
		timeline: originalAsset.timeline,
	},
};
export function selection(
	active: ActivePlayback | null = preparedActive,
): PlaybackSelectionResponse {
	return {
		source,
		resolvedAudioStreamIndex: 1,
		choices: [originalChoice, preparedChoice],
		active,
		pending: false,
		reason: active ? null : "no-playable-asset",
	};
}
export function options(): PlaybackOptionsResponse {
	return {
		source,
		resolvedAudioStreamIndex: 1,
		pending: false,
		assets: [originalAsset, preparedAsset].map((asset) => ({
			asset,
			descriptionId: asset.revision,
			audio: { streamIndex: 1, sourceStreamIndex: 1, position: 0 },
			queries: [
				{
					id: "combined",
					type: "file",
					contentType: `${asset.mimeType}; codecs="${asset.video?.codecString}"`,
					video: null,
					audio: null,
				},
			],
		})),
	};
}
