import { fingerprint } from "../../../shared/fingerprint.js";
import type {
	MediaExecutionSpecification,
	MediaProcessingPlan,
} from "../../../shared/media-processing.js";
import { type DeepReadonly, freeze } from "../../../shared/policy.js";
import type { PreparationMode } from "../../../shared/settings.js";
import type { CheckedCompatibility } from "./model.js";
import {
	encodedVideoSpec,
	exceedsH264Level,
	videoEncodingFilters,
} from "./output-spec.js";

const version = "preparation-execution:2";
export type PreparationExecutionPlan =
	| { kind: "direct"; fileId: string; sourceVersion: string }
	| { kind: "blocked"; reason: string }
	| {
			kind: "processing";
			mode: "remux" | "transcode-audio" | "transcode-video" | "transcode";
			profileFingerprint: string;
			reasons: { video: string; audio: string };
			request: MediaExecutionSpecification;
	  };

/** Pure profile-policy resolution. Source access, browser negotiation and execution preflight belong to their applications. */
export function resolveExecutionPlan(
	input: DeepReadonly<CheckedCompatibility>,
	mode: PreparationMode = "compatible",
	forcePreparation = false,
): PreparationExecutionPlan {
	const { profile, output } = input;
	if (!forcePreparation && input.direct.status === "supported")
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
	const audios = input.selectedAudioStreamIndices.map((index) => {
		const track = input.audioTracks.find(
			(track) => track.stream.index === index,
		);
		if (!track) throw new Error("Checked audio selection is inconsistent.");
		return track.stream;
	});
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
	const copyCompatibleStreams =
		mode === "fast" && profile.copyCompatibleStreams;
	const videoAction =
		copyCompatibleStreams && !resize ? output.copyVideo : "unsupported";
	const audioAction = !audio
		? "supported"
		: copyCompatibleStreams && !stereo
			? output.copyAudio
			: "unsupported";
	if (videoAction === "unknown" || audioAction === "unknown")
		return { kind: "blocked", reason: "source-stream-compatibility-unknown" };
	const v = videoAction === "supported" ? "copy" : "encode";
	const a =
		mode === "compatible" || audioAction !== "supported" ? "encode" : "copy";
	if (output.combinations[`${v}-${a}`] !== "supported")
		return { kind: "blocked", reason: "output-combination-unverified" };
	if (v === "encode" && (!video.width || !video.height || !video.frameRate))
		return { kind: "blocked", reason: "video-dimensions-unverified" };
	if (
		v === "encode" &&
		profile.video.encoder === "libx264" &&
		exceedsH264Level(encodedVideoSpec(video, profile.video))
	)
		return { kind: "blocked", reason: "h264-level-limit-exceeded" };
	const videoFilters =
		v === "encode" ? videoEncodingFilters(video, profile.video) : [];
	// All conversions, including libavfilter's auto audio conversion, are preflighted.
	const filters =
		v === "encode"
			? ["buffer", "buffersink", "null", "scale", "pad", "format"]
			: [];
	if (a === "encode" && audio)
		filters.push("abuffer", "abuffersink", "aresample", "aformat", "anull");
	const plan: MediaProcessingPlan = {
		id: fingerprint({
			version:
				v === "encode" && profile.video.encoder !== "libx264"
					? "preparation-execution:3"
					: version,
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
					...(profile.video.encoder === "libx264"
						? { h264Level: "5.1" as const }
						: {}),
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
						: !copyCompatibleStreams
							? "profile-encoding-required"
							: "browser-rejected",
			audio: !audio
				? "no-audio-stream"
				: a === "copy"
					? "browser-supported"
					: stereo
						? "profile-stereo-required"
						: !copyCompatibleStreams
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
