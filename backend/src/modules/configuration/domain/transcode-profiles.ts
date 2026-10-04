import type { Static } from "typebox";
import type { TranscodeProfileSchema } from "../../../contracts/schemas/transcode-profiles.js";
import { freeze } from "../../../shared/policy.js";

export type TranscodeProfile = Static<typeof TranscodeProfileSchema>;
export const defaultTranscodeProfileId = "builtin:balanced";
export const builtinTranscodeProfiles = freeze<TranscodeProfile[]>([
	{
		id: defaultTranscodeProfileId,
		name: "Balanced",
		description:
			"Prepare a Web copy with balanced encoding speed and size. Preserve compatible streams when possible.",
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
			"Prepare a Web copy faster when video encoding is needed, with potentially larger output. Preserve compatible streams when possible.",
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
]);
