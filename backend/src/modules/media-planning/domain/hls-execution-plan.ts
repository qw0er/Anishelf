import { fingerprint } from "../../../shared/fingerprint.js";
import type {
	HlsAudioExecution,
	HlsExecutionPlan,
	HlsExecutionRequest,
} from "../../../shared/media-processing.js";
import { type DeepReadonly, freeze } from "../../../shared/policy.js";
import { hlsPolicy } from "../../hls/policy.js";
import { resolveExecutionPlan } from "./execution-plan.js";
import type { CheckedCompatibility } from "./model.js";

export type HlsPlanningResult =
	| { kind: "blocked"; reason: string }
	| {
			kind: "processing";
			profileFingerprint: string;
			request: HlsExecutionRequest;
	  };

/** Pure HLS planning. A returned plan does not publish playlists or start a process. */
export function resolveHlsExecutionPlan(
	input: DeepReadonly<CheckedCompatibility>,
	targetSegmentDurationMs = hlsPolicy.targetSegmentDurationMs,
): HlsPlanningResult {
	if (
		!Number.isSafeInteger(targetSegmentDurationMs) ||
		targetSegmentDurationMs <= 0
	)
		throw new RangeError("Invalid HLS segment duration.");
	if (!input.profile || !input.output || input.output.target !== "hls")
		return { kind: "blocked", reason: "hls-output-not-selected" };
	if (input.profile.container !== "mp4")
		return { kind: "blocked", reason: "hls-profile-container-unsupported" };
	const audios: HlsAudioExecution[] = [];
	const plans = [];
	const selected = input.selectedAudioStreamIndices.map((index) => {
		const track = input.audioTracks.find(
			(track) => track.stream.index === index,
		);
		if (!track) throw new Error("Checked audio selection is inconsistent.");
		return track.stream;
	});
	const tracks = selected.length ? selected : [null];
	for (const track of tracks) {
		const checkedTrack = track
			? input.output.audioTracks.find(
					(item) => item.streamIndex === track.index,
				)
			: null;
		if (track && !checkedTrack)
			return { kind: "blocked", reason: "audio-output-evidence-missing" };
		const resolved = resolveExecutionPlan({
			...input,
			direct: { status: "unsupported", reason: "hls-packaging-required" },
			selectedAudioStreamIndices: track ? [track.index] : [],
			output: {
				...input.output,
				target: "media-source",
				copyAudio: checkedTrack?.copyAudio ?? "supported",
				combinations: checkedTrack?.combinations ?? input.output.combinations,
			},
		});
		if (resolved.kind !== "processing")
			return {
				kind: "blocked",
				reason:
					resolved.kind === "blocked"
						? resolved.reason
						: "hls-packaging-required",
			};
		plans.push(resolved);
		if (track)
			audios.push({
				sourceStreamIndex: track.index,
				trackId: `audio-${track.index}`,
				execution: resolved.request.plan.audio,
				...(resolved.request.plan.audioParameters
					? { parameters: resolved.request.plan.audioParameters }
					: {}),
				reason: resolved.reasons.audio,
			});
	}
	const first = plans[0];
	if (!first) return { kind: "blocked", reason: "no-video-stream" };
	const video = first.request.plan;
	const settings = {
		delivery: "hls" as const,
		segmentContainer: "fmp4" as const,
		packagingVersion: "hls:1" as const,
		targetSegmentDurationMs,
		videoStreamIndex: first.request.videoStreamIndex,
		video: video.video,
		...(video.videoParameters
			? { videoParameters: video.videoParameters }
			: {}),
		videoFilters: [...(video.videoFilters ?? [])],
		...(video.h264Level ? { h264Level: video.h264Level } : {}),
		videoReason: first.reasons.video,
		audioTracks: audios,
		filters: [...new Set(plans.flatMap((item) => item.request.plan.filters))],
	};
	const plan: HlsExecutionPlan = {
		...settings,
		id: fingerprint({
			version: "hls-execution:1",
			root: input.canonicalRoot,
			fileId: input.fileId,
			sourceVersion: input.sourceVersion,
			profileFingerprint: input.output.profileFingerprint,
			...settings,
		}),
	};
	return freeze({
		kind: "processing",
		profileFingerprint: input.output.profileFingerprint,
		request: {
			fileId: input.fileId,
			sourceVersion: input.sourceVersion,
			plan,
			sourceStartMs: 0,
		},
	});
}
