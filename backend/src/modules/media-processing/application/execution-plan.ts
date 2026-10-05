import { fingerprint } from "../../../shared/fingerprint.js";
import type { MediaProcessingPlan } from "../../../shared/media-processing.js";
import { type DeepReadonly, freeze } from "../../../shared/policy.js";
import type { CheckedCompatibility } from "../../media-compatibility/public.js";
import type { MediaExecutionRequest } from "./processing.js";

const version = "preparation-execution:2";
export type PreparationExecutionPlan =
	| { kind: "direct"; fileId: string; sourceVersion: string }
	| { kind: "blocked"; reason: string }
	| {
			kind: "processing";
			mode: "remux" | "transcode-audio" | "transcode-video" | "transcode";
			profileFingerprint: string;
			reasons: { video: string; audio: string };
			request: MediaExecutionRequest;
	  };

/** Pure profile-policy resolution. Source access, browser negotiation and execution preflight belong to their applications. */
export function resolveExecutionPlan(
	input: DeepReadonly<CheckedCompatibility>,
): PreparationExecutionPlan {
	const { profile, output } = input;
	if (output?.target === "hls")
		return { kind: "blocked", reason: "hls-execution-unavailable" };
	if (input.direct.status === "supported")
		return {
			kind: "direct",
			fileId: input.fileId,
			sourceVersion: input.sourceVersion,
		};
	if (!profile || !output)
		return { kind: "blocked", reason: "output-not-selected" };
	if (output.target === "media-source" && profile.container !== "mp4")
		return { kind: "blocked", reason: "fragmented-container-unimplemented" };
	const video = input.selectedVideo;
	const audios =
		input.selectedAudioTracks ??
		(input.selectedAudio ? [input.selectedAudio] : []);
	const audio = audios[0];
	if (!video) return { kind: "blocked", reason: "no-video-stream" };
	if (video.hdr)
		return { kind: "blocked", reason: "hdr-conversion-unverified" };
	const resize =
		profile.video.maxHeight !== undefined &&
		(video.height === null || video.height > profile.video.maxHeight);
	const stereo =
		profile.audio.channels === "stereo" &&
		audios.some((audio) => audio.channels !== 2);
	const videoAction =
		profile.copyCompatibleStreams && !resize ? output.copyVideo : "unsupported";
	const audioAction = !audio
		? "supported"
		: profile.copyCompatibleStreams && !stereo
			? output.copyAudio
			: "unsupported";
	if (videoAction === "unknown" || audioAction === "unknown")
		return { kind: "blocked", reason: "source-stream-compatibility-unknown" };
	const v = videoAction === "supported" ? "copy" : "encode";
	const a = audioAction === "supported" ? "copy" : "encode";
	if (output.combinations[`${v}-${a}`] !== "supported")
		return { kind: "blocked", reason: "output-combination-unverified" };
	if (v === "encode" && (!video.width || !video.height || !video.frameRate))
		return { kind: "blocked", reason: "video-dimensions-unverified" };
	if (v === "encode" && profile.video.encoder === "libx264") {
		const height = Math.min(
			video.height ?? 0,
			profile.video.maxHeight ?? Number.POSITIVE_INFINITY,
		);
		const width =
			Math.ceil(((video.width ?? 0) * height) / (video.height ?? 1) / 2) * 2;
		const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
		if (macroblocks > 36864 || macroblocks * (video.frameRate ?? 0) > 983040)
			return { kind: "blocked", reason: "h264-level-limit-exceeded" };
	}
	const videoFilters: string[] = [];
	if (v === "encode") {
		if (resize && profile.video.maxHeight)
			videoFilters.push(
				`scale=w=-2:h=${profile.video.maxHeight}:flags=lanczos`,
			);
		videoFilters.push(
			"pad=ceil(iw/2)*2:ceil(ih/2)*2",
			`format=${profile.video.pixelFormat}`,
		);
	}
	// All conversions, including libavfilter's auto audio conversion, are preflighted.
	const filters =
		v === "encode"
			? ["buffer", "buffersink", "null", "scale", "pad", "format"]
			: [];
	if (a === "encode" && audio)
		filters.push("abuffer", "abuffersink", "aresample", "aformat", "anull");
	const plan: MediaProcessingPlan = {
		id: fingerprint({
			version,
			fileId: input.fileId,
			root: input.canonicalRoot,
			sourceVersion: input.sourceVersion,
			profileFingerprint: output.profileFingerprint,
			delivery: output.target,
			video: video.index,
			audio: audios.map((audio) => audio.index),
			v,
			a,
		}),
		container: profile.container,
		delivery: output.target,
		outputFormat: profile.container === "mov" ? "mov" : profile.container,
		video:
			v === "copy"
				? { action: "copy" }
				: {
						action: "encode",
						encoder: profile.video.encoder,
						codec: profile.video.codec,
						pixelFormat: profile.video.pixelFormat,
					},
		audio:
			a === "copy"
				? { action: "copy" }
				: {
						action: "encode",
						encoder: profile.audio.encoder,
						codec: profile.audio.codec,
					},
		filters,
		...(v === "encode"
			? {
					videoParameters: structuredClone(profile.video),
					videoFilters,
					h264Level: "5.1" as const,
				}
			: {}),
		...(a === "encode"
			? { audioParameters: structuredClone(profile.audio) }
			: {}),
	};
	return {
		kind: "processing",
		mode:
			v === "copy"
				? a === "copy"
					? "remux"
					: "transcode-audio"
				: a === "copy"
					? "transcode-video"
					: "transcode",
		profileFingerprint: output.profileFingerprint,
		reasons: {
			video:
				v === "copy"
					? "browser-supported"
					: resize
						? "profile-size-required"
						: !profile.copyCompatibleStreams
							? "profile-encoding-required"
							: "browser-rejected",
			audio: !audio
				? "no-audio-stream"
				: a === "copy"
					? "browser-supported"
					: stereo
						? "profile-stereo-required"
						: !profile.copyCompatibleStreams
							? "profile-encoding-required"
							: "browser-rejected",
		},
		request: {
			fileId: input.fileId,
			sourceVersion: input.sourceVersion,
			plan: freeze(plan),
			videoStreamIndex: video.index,
			audioStreamIndices: audios.map((audio) => audio.index),
		},
	};
}
