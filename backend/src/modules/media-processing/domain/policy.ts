import type {
	MediaProcessingOperation,
	MediaProcessingPlan,
	MediaProcessingProfile,
} from "../../../shared/media-processing.js";
import {
	type DeepReadonly,
	freeze,
	requirePolicy,
	validateNumericPolicy,
} from "../../../shared/policy.js";

export type MediaProcessingMode =
	| "remux"
	| "transcode-audio"
	| "transcode-video"
	| "transcode";
const operations: Record<MediaProcessingMode, MediaProcessingOperation> = {
	remux: { video: "copy", audio: "copy" },
	"transcode-audio": { video: "copy", audio: "encode" },
	"transcode-video": { video: "encode", audio: "copy" },
	transcode: { video: "encode", audio: "encode" },
};
export interface MediaProcessingPolicy {
	concurrency: number;
	processingTimeoutMs: number;
	maximumProcessedBytes: number;
	profile: MediaProcessingProfile;
	operations: Record<MediaProcessingMode, MediaProcessingOperation>;
}
export const mediaProcessingPolicy = freeze<MediaProcessingPolicy>({
	concurrency: 1,
	processingTimeoutMs: 6 * 60 * 60 * 1000,
	maximumProcessedBytes: 10 * 1024 * 1024 * 1024,
	profile: {
		id: "mp4-h264-aac-v1",
		container: "mp4",
		fastStart: true,
		durationToleranceSeconds: 2,
		durationToleranceFrames: 2,
		video: {
			encoder: "libx264",
			codec: "h264",
			pixelFormat: "yuv420p",
			crf: 20,
			preset: "medium",
			threads: 2,
			padToEven: true,
			frameRateMode: "passthrough",
			hdrHandling: "reject",
		},
		audio: { encoder: "aac", codec: "aac", bitRate: 192000 },
	},
	operations,
});
export function validateMediaProcessingPolicy(
	policy: DeepReadonly<MediaProcessingPolicy>,
): void {
	validateNumericPolicy("mediaProcessing", policy, mediaProcessingPolicy);
	requirePolicy(policy.concurrency === 1, "mediaProcessing.concurrency");
	validateNumericPolicy(
		"mediaProcessing.profile",
		policy.profile,
		mediaProcessingPolicy.profile,
	);
	validateNumericPolicy(
		"mediaProcessing.profile.video",
		policy.profile.video,
		mediaProcessingPolicy.profile.video,
	);
	validateNumericPolicy(
		"mediaProcessing.profile.audio",
		policy.profile.audio,
		mediaProcessingPolicy.profile.audio,
	);
	const profile = policy.profile;
	requirePolicy(
		typeof profile.id === "string" && /^[a-z0-9-]+-v[1-9]\d*$/.test(profile.id),
		"mediaProcessing.profile.id",
	);
	requirePolicy(
		profile.container === "mp4" && typeof profile.fastStart === "boolean",
		"mediaProcessing.profile.container",
	);
	requirePolicy(
		profile.video.encoder === "libx264" &&
			profile.video.codec === "h264" &&
			profile.video.pixelFormat === "yuv420p" &&
			profile.video.preset === "medium" &&
			profile.video.frameRateMode === "passthrough" &&
			profile.video.hdrHandling === "reject" &&
			typeof profile.video.padToEven === "boolean",
		"mediaProcessing.profile.video",
	);
	requirePolicy(profile.video.crf <= 51, "mediaProcessing.profile.video.crf");
	requirePolicy(
		profile.audio.encoder === "aac" && profile.audio.codec === "aac",
		"mediaProcessing.profile.audio",
	);
	// Operation names have stable semantics; injection cannot turn remux into encoding.
	requirePolicy(
		Object.keys(policy.operations).length === Object.keys(operations).length,
		"mediaProcessing.operations",
	);
	for (const [mode, operation] of Object.entries(operations)) {
		const candidate = policy.operations[mode as MediaProcessingMode];
		requirePolicy(
			candidate?.video === operation.video &&
				candidate?.audio === operation.audio,
			`mediaProcessing.operations.${mode}`,
		);
	}
}
export function resolveMediaProcessingPlan(
	policy: DeepReadonly<MediaProcessingPolicy>,
	mode: MediaProcessingMode,
): DeepReadonly<MediaProcessingPlan> {
	requirePolicy(Object.hasOwn(policy.operations, mode), "mediaProcessing.mode");
	return freeze({
		profile: structuredClone(policy.profile),
		operation: structuredClone(policy.operations[mode]),
	});
}
