import { freeze } from "../../../shared/policy.js";
import type { TranscodeProfile } from "../../../shared/transcode-profiles.js";

export type { TranscodeProfile } from "../../../shared/transcode-profiles.js";
export const defaultTranscodeProfileId = "builtin:balanced";
export const builtinTranscodeProfiles = freeze<TranscodeProfile[]>([
	{
		id: defaultTranscodeProfileId,
		name: "Balanced",
		description: "Prepare a Web copy with balanced encoding speed and size.",
		usage: "preparation",
		container: "mp4",
		copyCompatibleStreams: true,
		video: {
			encoder: "libx264",
			codec: "h264",
			pixelFormat: "yuv420p",
			crf: 23,
			preset: "medium",
		},
		audio: {
			encoder: "aac",
			codec: "aac",
			bitrateKbps: 192,
			channels: "preserve",
		},
	},
	{
		id: "builtin:fast",
		name: "Fast",
		description:
			"Prepare a Web copy faster when video encoding is needed, with potentially larger output.",
		usage: "preparation",
		container: "mp4",
		copyCompatibleStreams: true,
		video: {
			encoder: "libx264",
			codec: "h264",
			pixelFormat: "yuv420p",
			crf: 23,
			preset: "veryfast",
		},
		audio: {
			encoder: "aac",
			codec: "aac",
			bitrateKbps: 192,
			channels: "preserve",
		},
	},
	{
		id: "builtin:efficient",
		name: "Efficient",
		description: "Prepare a VP9/Opus WebM copy with efficient compression.",
		usage: "preparation",
		container: "webm",
		copyCompatibleStreams: true,
		video: {
			encoder: "libvpx-vp9",
			codec: "vp9",
			pixelFormat: "yuv420p",
			crf: 32,
			cpuUsed: 4,
		},
		audio: {
			encoder: "libopus",
			codec: "opus",
			bitrateKbps: 128,
			channels: "preserve",
		},
	},
	{
		id: "builtin:compact",
		name: "Compact",
		description: "Prepare a smaller VP9/Opus WebM copy with slower encoding.",
		usage: "preparation",
		container: "webm",
		copyCompatibleStreams: true,
		video: {
			encoder: "libvpx-vp9",
			codec: "vp9",
			pixelFormat: "yuv420p",
			crf: 32,
			cpuUsed: 2,
		},
		audio: {
			encoder: "libopus",
			codec: "opus",
			bitrateKbps: 128,
			channels: "preserve",
		},
	},
]);
