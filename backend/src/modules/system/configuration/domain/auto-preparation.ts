import type { AutoPreparationPreset } from "../../../../contracts/auto-preparation.js";
import { freeze } from "../../../../shared/policy.js";

export type { AutoPreparationPreset } from "../../../../contracts/auto-preparation.js";
export const builtinAutoPreparationPresets = freeze<AutoPreparationPreset[]>([
	{
		id: "builtin:web",
		name: "Web",
		description:
			"Accept H.264 and VP9 SDR video while preserving audio formats.",
		audio: { selection: "all" },
		accept: {
			containers: ["mp4", "webm"],
			video: [
				{
					codecs: ["h264", "vp9"],
					pixelFormats: ["yuv420p"],
					dynamicRanges: ["sdr"],
				},
			],
			audio: [],
		},
		transcodeProfileId: "builtin:balanced",
	},
	{
		id: "builtin:web-conservative",
		name: "Web · Conservative",
		description: "Prepare H.264 SDR MP4 copies with AAC audio.",
		audio: { selection: "all" },
		accept: {
			containers: ["mp4"],
			video: [
				{
					codecs: ["h264"],
					profiles: ["baseline", "constrained-baseline", "main", "high"],
					pixelFormats: ["yuv420p"],
					dynamicRanges: ["sdr"],
				},
			],
			audio: [{ codecs: ["aac"], profiles: ["lc"] }],
		},
		transcodeProfileId: "builtin:balanced",
	},
]);
