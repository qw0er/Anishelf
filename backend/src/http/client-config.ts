import type { BuiltinPolicy, DeepReadonly } from "../config/policy.js";
import type { ClientConfigResponse } from "./contracts.js";
/** Explicit whitelist: never serialize the effective server configuration. */
export function clientConfigResponse(
	policy: DeepReadonly<BuiltinPolicy>,
): ClientConfigResponse {
	return {
		defaultLanguage: "en",
		library: {
			defaultScanIntervalMinutes: policy.library.defaultScanIntervalMinutes,
			maximumScanIntervalMinutes: policy.library.maximumScanIntervalMinutes,
		},
		playback: {
			progressSaveIntervalMs: policy.client.progressSaveIntervalMs,
			requestTimeoutMs: policy.client.playbackRequestTimeoutMs,
		},
		subtitles: {
			maximumBytes: policy.subtitles.maximumBytes,
			initializationTimeoutMs: policy.client.subtitleInitializationTimeoutMs,
			memoryMaximumBytes: policy.client.subtitleMemoryMaximumBytes,
			formats: [...new Set(Object.values(policy.subtitles.formats))],
		},
		media: { videoMimeTypes: { ...policy.media.videoMimeTypes } },
	};
}
