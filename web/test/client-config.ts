import type { ClientConfigResponse } from "../src/api/contracts.js";
export const clientConfig: ClientConfigResponse = {
	defaultLanguage: "en",
	library: {
		defaultScanIntervalMinutes: 60,
		maximumScanIntervalMinutes: 10080,
	},
	playback: { progressSaveIntervalMs: 5000, requestTimeoutMs: 5000 },
	subtitles: {
		maximumBytes: 10485760,
		initializationTimeoutMs: 15000,
		memoryMaximumBytes: 67108864,
		formats: ["vtt", "srt", "ass", "ssa"],
	},
	media: {
		videoMimeTypes: {
			".mp4": "video/mp4",
			".m4v": "video/mp4",
			".webm": "video/webm",
			".mkv": "video/x-matroska",
		},
	},
};
