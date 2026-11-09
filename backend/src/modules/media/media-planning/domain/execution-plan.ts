import { canMux } from "../../../../platform/media/acceptance-policy.js";
import { filterName } from "../../../../platform/media/encoding-policy.js";
import type { MediaProcessingPlan } from "../../../../platform/media/specification.js";
import { fingerprint } from "../../../../shared/fingerprint.js";
import { type DeepReadonly, freeze } from "../../../../shared/policy.js";
import type { MediaExecutionSpecification } from "../../media-processing/public.js";
import type { CheckedCompatibility } from "./model.js";
import { videoEncodingFilters } from "./output-spec.js";

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
	const resize =
		!!profile.video.filters?.length ||
		(profile.video.maxHeight !== undefined &&
			(video.height === null || video.height > profile.video.maxHeight)) ||
		(profile.video.maxWidth !== undefined &&
			(video.width === null || video.width > profile.video.maxWidth)) ||
		(profile.video.maxFrameRate !== undefined &&
			(video.frameRate === null ||
				video.frameRate > profile.video.maxFrameRate));
	const copyCompatibleStreams = profile.copyCompatibleStreams;
	const canCopyVideo =
		!resize &&
		output.copyVideo === "supported" &&
		canMux(profile.container, video.codec, "video") &&
		(profile.video.encoder !== "copy" ||
			!profile.video.codec ||
			profile.video.codec === video.codec);
	if (profile.video.encoder === "copy" && !canCopyVideo)
		return { kind: "blocked", reason: "forced-video-copy-unavailable" };
	const v =
		profile.video.encoder === "copy" || (copyCompatibleStreams && canCopyVideo)
			? "copy"
			: "encode";
	if (v === "encode" && !profile.video.codec)
		return { kind: "blocked", reason: "video-codec-required" };
	const tracks = audios.map((audio) => {
		const evidence = output.audioTracks?.find(
			(t) => t.streamIndex === audio.index,
		);
		const canCopy =
			!profile.audio.filters?.length &&
			(profile.audio.channels === undefined ||
				profile.audio.channels === audio.channels) &&
			(profile.audio.sampleRate === undefined ||
				profile.audio.sampleRate === audio.sampleRate) &&
			(evidence?.copyAudio ?? output.copyAudio) === "supported" &&
			canMux(profile.container, audio.codec, "audio") &&
			(profile.audio.encoder !== "copy" ||
				!profile.audio.codec ||
				profile.audio.codec === audio.codec);
		const copy =
			(profile.audio.encoder === "copy" && canCopy) ||
			(copyCompatibleStreams && canCopy);
		return {
			sourceIndex: audio.index,
			default: audio.default ?? audio.index === input.defaultAudioStreamIndex,
			execution: copy
				? { action: "copy" as const }
				: {
						action: "encode" as const,
						encoder: profile.audio.encoder,
						codec: profile.audio.codec,
					},
			...(copy ? {} : { parameters: structuredClone(profile.audio) }),
		};
	});
	if (
		profile.audio.encoder === "copy" &&
		tracks.some((t) => t.execution.action !== "copy")
	)
		return { kind: "blocked", reason: "forced-audio-copy-unavailable" };
	const a = tracks.some((t) => t.execution.action === "encode")
		? "encode"
		: "copy";
	if (a === "encode" && !profile.audio.codec)
		return { kind: "blocked", reason: "audio-codec-required" };
	if (v === "encode" && video.hdr && !profile.video.filters?.length)
		return { kind: "blocked", reason: "hdr-conversion-unverified" };
	if (!forcePreparation && output.combinations[`${v}-${a}`] === "unsupported")
		return { kind: "blocked", reason: "output-combination-unverified" };
	const videoFilters =
		v === "encode" ? videoEncodingFilters(video, profile.video) : [];
	const filters = [
		...new Set([
			...(v === "encode"
				? [
						"buffer",
						"buffersink",
						"null",
						"scale",
						"pad",
						...videoFilters.map(filterName),
					]
				: []),
			...(a === "encode"
				? [
						"abuffer",
						"abuffersink",
						"aresample",
						"aformat",
						"anull",
						...(profile.audio.filters ?? []).map(filterName),
					]
				: []),
		]),
	];
	const plan: MediaProcessingPlan = {
		id: "",
		compilerVersion: 2,
		globalOptions: structuredClone(profile.globalOptions),
		inputOptions: structuredClone(profile.inputOptions),
		muxerOptions: structuredClone(profile.muxerOptions),
		audioTracks: tracks,
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
				}
			: {}),
		...(a === "encode"
			? { audioParameters: structuredClone(profile.audio) }
			: {}),
	};
	plan.id = fingerprint({
		version: "preparation-execution:4",
		source: {
			fileId: input.fileId,
			root: input.scopeId,
			sourceVersion: input.sourceVersion,
		},
		profileFingerprint: output.profileFingerprint,
		videoStreamIndex: video.index,
		audioStreamIndices: audios.map((a) => a.index),
		plan,
	});
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
					: profile.audio.channels ||
							profile.audio.sampleRate ||
							profile.audio.filters?.length
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
