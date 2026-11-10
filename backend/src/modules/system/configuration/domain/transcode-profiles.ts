import { freeze } from "../../../../shared/policy.js";
import type { TranscodeProfile } from "../profile.js";

export type { TranscodeProfile } from "../profile.js";
export const defaultTranscodeProfileId = "builtin:manual";
export const builtinTranscodeProfiles = freeze<TranscodeProfile[]>([
	{
		id: defaultTranscodeProfileId,
		name: "Matroska",
		description:
			"Prepare a Matroska copy retaining subtitles, fonts and chapters.",
		container: "matroska",
		copyCompatibleStreams: false,
		video: {
			encoder: "libx264",
			codec: "h264",
			pixelFormat: "yuv420p",
			options: { crf: 23, preset: "medium" },
		},
		audio: { encoder: "aac", codec: "aac", options: { b: "192k" } },
	},
	{
		id: "builtin:balanced",
		name: "Balanced",
		description: "Prepare a Web copy with balanced encoding speed and size.",
		container: "mp4",
		copyCompatibleStreams: false,
		video: {
			encoder: "libx264",
			codec: "h264",
			pixelFormat: "yuv420p",
			options: { crf: 23, preset: "medium", profile: "high", level: "5.1" },
		},
		audio: {
			encoder: "aac",
			codec: "aac",
			options: { b: "192k", profile: "aac_low" },
		},
	},
	{
		id: "builtin:fast",
		name: "Fast",
		description:
			"Prepare a Web copy faster when video encoding is needed, with potentially larger output.",
		container: "mp4",
		copyCompatibleStreams: false,
		video: {
			encoder: "libx264",
			codec: "h264",
			pixelFormat: "yuv420p",
			options: { crf: 23, preset: "veryfast", profile: "high", level: "5.1" },
		},
		audio: {
			encoder: "aac",
			codec: "aac",
			options: { b: "192k", profile: "aac_low" },
		},
	},
	{
		id: "builtin:efficient",
		name: "Efficient",
		description: "Prepare a VP9/Opus WebM copy with efficient compression.",
		container: "webm",
		copyCompatibleStreams: false,
		video: {
			encoder: "libvpx-vp9",
			codec: "vp9",
			pixelFormat: "yuv420p",
			options: { crf: 32, "cpu-used": 4, b: 0 },
		},
		audio: {
			encoder: "libopus",
			codec: "opus",
			options: { b: "128k" },
		},
	},
	{
		id: "builtin:compact",
		name: "Compact",
		description: "Prepare a smaller VP9/Opus WebM copy with slower encoding.",
		container: "webm",
		copyCompatibleStreams: false,
		video: {
			encoder: "libvpx-vp9",
			codec: "vp9",
			pixelFormat: "yuv420p",
			options: { crf: 32, "cpu-used": 2, b: 0 },
		},
		audio: {
			encoder: "libopus",
			codec: "opus",
			options: { b: "128k" },
		},
	},
]);
